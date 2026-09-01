import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { AssignmentType, ClassLevelCategory, Prisma, Role } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { PoliciesGuard } from "../../casl/policies.guard";
import { CheckPolicies } from "../../casl/check-policies.decorator";
import { AbilityFactory } from "../../casl/ability.factory";
import { CurrentUser } from "../../auth/current-user.decorator";
import type { RequestUser } from "../../auth/jwt.strategy";
import { UserService } from "../users/user.service";
import { InvitationService } from "../invitations/invitation.service";
import { StudentSubjectEnrollmentService } from "../../subjects/student-subject-enrollment";
import { STORAGE_ADAPTER, type StorageAdapter } from "../../storage/storage-adapter";
import { CreateStudentDto, GuardianInputDto } from "./dto/create-student.dto";
import { UpdateStudentDto } from "./dto/update-student.dto";

type Tx = Prisma.TransactionClient;

const STUDENT_LIST_INCLUDE = {
  user: true,
  currentClass: { include: { classLevel: true } },
  // Just enough to show a parent contact column on the listing page — the
  // full guardian relation (findOneForUser) already includes everything
  // else. Scoped to the primary contact only, matching one call site's
  // worth of need rather than every guardian.
  guardians: {
    where: { isPrimaryContact: true },
    take: 1,
    select: { parent: { select: { user: { select: { phone: true } } } } },
  },
} satisfies Prisma.StudentProfileInclude;

const SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_PHOTO_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Maps ClassLevelCategory to the 2-digit admission-number code (see
// generateAdmissionNumber): creche=01, nursery=02, primary=03, jss=04, sss=05.
// RECEPTION was added after the other five were already issuing admission
// numbers, so it gets a fresh, previously-unused code (06) rather than a
// renumber — the per-(session, code) sequence in generateAdmissionNumber
// means reassigning any existing code would silently start a new NNNN
// sequence under a category that already has issued admission numbers.
const CLASS_LEVEL_CATEGORY_CODE: Record<ClassLevelCategory, string> = {
  CRECHE: "01",
  NURSERY: "02",
  PRIMARY: "03",
  JSS: "04",
  SSS: "05",
  RECEPTION: "06",
};

@Injectable()
export class StudentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly invitationService: InvitationService,
    private readonly enrollmentService: StudentSubjectEnrollmentService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  /**
   * PRD FR1.3: atomic student creation — User + StudentProfile + every
   * guardian link, all-or-nothing (the deferred DB trigger from the `people`
   * migration is defense-in-depth on top of this). Each guardian resolves to
   * a ParentProfile one of three ways (see `resolveGuardian`): an existing
   * ParentProfile id passed straight through; an existing User (e.g. already
   * STAFF) who gains the PARENT role and a fresh ParentProfile (FR1.5 — one
   * person, one account); or a brand-new inline invite, whose ParentProfile
   * is created immediately by `InvitationService.createInTx` so the
   * StudentGuardian FK has something to point at before the invite is ever
   * accepted.
   */
  // `admissionYearOverride` is never exposed on CreateStudentDto/POST
  // /students — only the legacy CSV importer (legacy-import.service.ts)
  // passes it, for a migrated student whose real original admission year
  // predates the class arm's current academic session.
  async create(dto: CreateStudentDto, options?: { admissionYearOverride?: number }) {
    const pendingInvites: { email: string; rawToken: string }[] = [];

    const student = await this.prisma.$transaction(async (tx) => {
      const admissionNumber = await this.generateAdmissionNumber(tx, dto.classArmId, options?.admissionYearOverride);

      // Students are created directly, never invited (PRD FR1.3), and are
      // frequently minors with no independent email. A synthetic,
      // non-deliverable address satisfies User.email's NOT NULL + UNIQUE
      // constraint without being usable for login — no passwordHash is ever
      // set for this path, and login requires one.
      const syntheticEmail = UserService.normalizeEmail(
        `student.${admissionNumber}@no-email.internal`,
      );

      const user = await tx.user.create({
        data: {
          email: syntheticEmail,
          firstName: dto.firstName,
          lastName: dto.lastName,
          middleName: dto.middleName,
          gender: dto.gender,
          dateOfBirth: dto.dateOfBirth,
          status: "active",
        },
      });
      await tx.userRole.create({ data: { userId: user.id, role: Role.STUDENT } });

      const studentProfile = await tx.studentProfile.create({
        data: {
          userId: user.id,
          admissionNumber,
          admissionDate: dto.admissionDate,
          currentClassId: dto.classArmId,
        },
      });

      for (const guardian of dto.guardians) {
        const parentProfileId = await this.resolveGuardian(tx, guardian, pendingInvites);
        await tx.studentGuardian.create({
          data: {
            studentId: studentProfile.id,
            parentId: parentProfileId,
            relationship: guardian.relationship,
            isPrimaryContact: guardian.isPrimaryContact ?? false,
            isEmergencyContact: guardian.isEmergencyContact ?? false,
          },
        });
      }

      // PRD §3.3: COMPULSORY subjects auto-enroll on class assignment —
      // same transaction, so a student is never left without their required
      // subjects if anything downstream fails.
      await this.enrollmentService.syncCompulsoryEnrollmentsOnClassAssignment(tx, {
        studentId: studentProfile.id,
        classArmId: dto.classArmId,
      });

      return studentProfile;
    }, { timeout: 15000 });

    // Emails go out only after the transaction commits — a failed send
    // shouldn't roll back a real student/guardian record.
    for (const invite of pendingInvites) {
      await this.invitationService.sendInviteEmail(invite.email, invite.rawToken);
    }

    return student;
  }

  /**
   * Admission number format: YYYY/CC/NNNN — YYYY is the assigned class arm's
   * academic session start year, CC is the 2-digit class-level-category code
   * (CLASS_LEVEL_CATEGORY_CODE), NNNN is a 4-digit sequence that resets per
   * (session, category) and is derived from existing admissionNumbers rather
   * than a class-arm headcount, so it stays correct even after a student is
   * later promoted/reassigned to a different class arm.
   *
   * pg_advisory_xact_lock serializes concurrent creates for the same
   * (session, category) prefix for the lifetime of this transaction (auto
   * released on commit/rollback) — without it, two concurrent requests could
   * both read the same "last" admission number and collide on the same
   * NNNN, which the admissionNumber @unique constraint would then reject.
   */
  private async generateAdmissionNumber(tx: Tx, classArmId: string, yearOverride?: number): Promise<string> {
    const classArm = await tx.classArm.findUnique({
      where: { id: classArmId },
      include: { classLevel: true, academicSession: true },
    });
    if (!classArm) {
      throw new BadRequestException(`No ClassArm found for id ${classArmId}`);
    }

    const year = yearOverride ?? classArm.academicSession.startDate.getFullYear();
    const code = CLASS_LEVEL_CATEGORY_CODE[classArm.classLevel.category];
    const prefix = `${year}/${code}/`;

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${prefix}))`;

    const last = await tx.studentProfile.findFirst({
      where: { admissionNumber: { startsWith: prefix } },
      orderBy: { admissionNumber: "desc" },
    });
    const nextSeq = last ? Number(last.admissionNumber.slice(prefix.length)) + 1 : 1;

    return `${prefix}${String(nextSeq).padStart(4, "0")}`;
  }

  private async resolveGuardian(
    tx: Tx,
    guardian: GuardianInputDto,
    pendingInvites: { email: string; rawToken: string }[],
  ): Promise<string> {
    if (guardian.existingParentProfileId) {
      const existing = await tx.parentProfile.findUnique({
        where: { id: guardian.existingParentProfileId },
      });
      if (!existing) {
        throw new BadRequestException(
          `No ParentProfile found for id ${guardian.existingParentProfileId}`,
        );
      }
      return existing.id;
    }

    if (!guardian.email || !guardian.firstName || !guardian.lastName) {
      throw new BadRequestException(
        "Each guardian needs either existingParentProfileId or email + firstName + lastName",
      );
    }

    const email = UserService.normalizeEmail(guardian.email);
    const existingUser = await tx.user.findUnique({ where: { email } });

    if (existingUser) {
      // FR1.5: an existing user (e.g. already STAFF) gains the PARENT role
      // rather than receiving a second invite.
      await this.userService.grantRole(existingUser.id, Role.PARENT, tx);
      const existingParentProfile = await tx.parentProfile.findUnique({
        where: { userId: existingUser.id },
      });
      if (existingParentProfile) return existingParentProfile.id;
      const created = await tx.parentProfile.create({ data: { userId: existingUser.id } });
      return created.id;
    }

    const { invitation, rawToken, userId } = await this.invitationService.createInTx(tx, {
      email,
      firstName: guardian.firstName,
      lastName: guardian.lastName,
      invitedRole: Role.PARENT,
    });
    pendingInvites.push({ email: invitation.email, rawToken });

    if (guardian.phone || guardian.address) {
      if (guardian.phone) await tx.user.update({ where: { id: userId }, data: { phone: guardian.phone } });
      if (guardian.address) {
        await tx.parentProfile.update({ where: { userId }, data: { address: guardian.address } });
      }
    }

    const parentProfile = await tx.parentProfile.findUniqueOrThrow({ where: { userId } });
    return parentProfile.id;
  }

  /**
   * Name/gender/dateOfBirth live on User, everything else (classArmId →
   * currentClassId, bloodGroup, medicalNotes, status) on StudentProfile —
   * both written in one transaction. Fields are mapped explicitly rather
   * than spreading `dto` straight into `data` (the previous implementation
   * did that, which silently passed an invalid `classArmId` key instead of
   * `currentClassId` — Prisma's own StudentProfileUpdateInput type would
   * reject it, but TS didn't catch it here since `dto` is a variable, not
   * an object literal, so excess-property checking never ran).
   *
   * PRD §3.3: reassigning a class arm re-syncs compulsory enrollment for
   * the new class, same transaction. Known limitation, not silently fixed:
   * this does not drop enrollments tied to the student's *previous* class
   * arm.
   */
  async update(id: string, dto: UpdateStudentDto) {
    const pendingInvites: { email: string; rawToken: string }[] = [];

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.studentProfile.findUniqueOrThrow({
        where: { id },
        include: { guardians: true },
      });

      if (
        dto.firstName !== undefined ||
        dto.lastName !== undefined ||
        dto.middleName !== undefined ||
        dto.gender !== undefined ||
        dto.dateOfBirth !== undefined
      ) {
        await tx.user.update({
          where: { id: existing.userId },
          data: {
            firstName: dto.firstName,
            lastName: dto.lastName,
            middleName: dto.middleName,
            gender: dto.gender,
            dateOfBirth: dto.dateOfBirth,
          },
        });
      }

      await tx.studentProfile.update({
        where: { id },
        data: {
          currentClassId: dto.classArmId,
          bloodGroup: dto.bloodGroup,
          medicalNotes: dto.medicalNotes,
          status: dto.status,
        },
      });

      if (dto.classArmId) {
        await this.enrollmentService.syncCompulsoryEnrollmentsOnClassAssignment(tx, {
          studentId: id,
          classArmId: dto.classArmId,
        });
      }

      if (dto.guardians) {
        await this.reconcileGuardians(tx, id, existing.guardians, dto.guardians, pendingInvites);
      }
    }, { timeout: 15000 });

    // Same as create(): emails go out only after the transaction commits.
    for (const invite of pendingInvites) {
      await this.invitationService.sendInviteEmail(invite.email, invite.rawToken);
    }

    return this.prisma.studentProfile.findUniqueOrThrow({
      where: { id },
      include: {
        ...STUDENT_LIST_INCLUDE,
        guardians: { include: { parent: { include: { user: true } } } },
      },
    });
  }

  /**
   * Find-diff reconciliation against the incoming full guardian list — same
   * shape as StaffAssignment.syncSubjectTeacherAssignments. Incoming rows
   * whose `existingParentProfileId` matches a currently-linked guardian's
   * `parentId` are kept (and updated if relationship/contact flags
   * changed); currently-linked guardians with no match in the incoming
   * list are removed; everything else is resolved via the same
   * `resolveGuardian` used by `create()` (covers both "link an existing,
   * currently-unlinked ParentProfile by id" and "inline-invite a brand-new
   * guardian") and newly linked.
   */
  private async reconcileGuardians(
    tx: Tx,
    studentId: string,
    current: { id: string; parentId: string }[],
    incoming: GuardianInputDto[],
    pendingInvites: { email: string; rawToken: string }[],
  ): Promise<void> {
    const incomingParentIds = new Set(
      incoming.map((g) => g.existingParentProfileId).filter((id): id is string => !!id),
    );
    const kept = current.filter((g) => incomingParentIds.has(g.parentId));
    const removed = current.filter((g) => !incomingParentIds.has(g.parentId));
    const newRows = incoming.filter(
      (g) => !g.existingParentProfileId || !current.some((c) => c.parentId === g.existingParentProfileId),
    );

    if (kept.length + newRows.length === 0) {
      throw new BadRequestException("A student must have at least one guardian.");
    }

    for (const guardian of removed) {
      await tx.studentGuardian.delete({ where: { id: guardian.id } });
    }

    for (const guardian of incoming) {
      if (!guardian.existingParentProfileId) continue;
      const match = current.find((c) => c.parentId === guardian.existingParentProfileId);
      if (!match) continue;
      await tx.studentGuardian.update({
        where: { id: match.id },
        data: {
          relationship: guardian.relationship,
          isPrimaryContact: guardian.isPrimaryContact ?? false,
          isEmergencyContact: guardian.isEmergencyContact ?? false,
        },
      });
    }

    for (const guardian of newRows) {
      const parentProfileId = await this.resolveGuardian(tx, guardian, pendingInvites);
      await tx.studentGuardian.create({
        data: {
          studentId,
          parentId: parentProfileId,
          relationship: guardian.relationship,
          isPrimaryContact: guardian.isPrimaryContact ?? false,
          isEmergencyContact: guardian.isEmergencyContact ?? false,
        },
      });
    }
  }

  /**
   * Passport photo for the term report card (report-card.processor.ts,
   * apps/worker, renders User.avatarUrl if set). Stores a freshly-signed
   * URL directly on User.avatarUrl — same "store the signed URL, not the
   * key" convention TermReportCard.pdfUrl already uses — rather than a
   * stable public URL, since StorageAdapter only exposes signed URLs.
   *
   * Admin/Super-Admin can upload for any student (isOverride, computed by
   * the controller from CASL's "manage StudentProfile"); anyone else must
   * be the active CLASS_TEACHER for this student's current class arm — same
   * row-level assignment check as ReportCommentService's CLASS_TEACHER
   * branch, not a CASL condition (CASL has no instance data to scope by at
   * guard time).
   */
  async uploadPhoto(studentId: string, file: Express.Multer.File, userId: string, isOverride: boolean) {
    const student = await this.prisma.studentProfile.findUniqueOrThrow({ where: { id: studentId } });

    if (!isOverride) {
      await this.assertIsClassTeacherFor(userId, student.currentClassId);
    }

    const key = `student-photos/${studentId}/${Date.now()}-${file.originalname}`;
    await this.storage.put(key, file.buffer, file.mimetype);
    const avatarUrl = await this.storage.getSignedUrl(key, SIGNED_URL_TTL_SECONDS);

    await this.prisma.user.update({ where: { id: student.userId }, data: { avatarUrl } });
    return { avatarUrl };
  }

  private async assertIsClassTeacherFor(userId: string, classArmId: string | null): Promise<void> {
    if (!classArmId) {
      throw new ForbiddenException("Student has no current class — only Admin/Super-Admin can upload a photo");
    }
    const staffProfile = await this.prisma.staffProfile.findUnique({ where: { userId } });
    const assignment = staffProfile
      ? await this.prisma.staffAssignment.findFirst({
          where: {
            staffId: staffProfile.id,
            isActive: true,
            assignmentType: AssignmentType.CLASS_TEACHER,
            classArmId,
          },
        })
      : null;
    if (!assignment) {
      throw new ForbiddenException("You are not the class teacher for this student");
    }
  }

  /**
   * PRD §5 row-level list scoping: SUPER_ADMIN/ADMIN see every student;
   * STAFF holding an active PRINCIPAL/HEADTEACHER/REGISTRAR assignment
   * (school-wide roles, not tied to a classArmId) see every student too,
   * matching their real-world remit (e.g. writing PRINCIPAL report-card
   * comments for any student, or Registrar enrolling/maintaining any
   * student — see ability.factory.ts's REGISTRAR block); other STAFF see
   * students in class arms they hold an active
   * CLASS_TEACHER or SUBJECT_TEACHER assignment for (subject-level narrowing
   * arrives in Phase 3 once StudentSubjectEnrollment exists); PARENT see
   * their own wards; STUDENT sees only themself. This is plain Prisma
   * `where` composition, not a CASL instance check, per PRD §5's own note
   * that scoped rules need row-level checks against StaffAssignment/
   * StudentGuardian, evaluated per-request.
   *
   * `filters.classArmId`/`search` narrow within that row-level scope;
   * `skip`/`take` paginate. `take` being present is what switches the return
   * shape to `{ data, total }` — omitting it (every caller before this)
   * keeps the plain-array response so no existing consumer breaks.
   */
  async findAllForUser(
    user: RequestUser,
    filters: { classArmId?: string; classLevelCategory?: ClassLevelCategory; search?: string; skip?: number; take?: number } = {},
  ) {
    const scopeWhere = await this.scopeWhereForUser(user);
    if (scopeWhere === null) return filters.take !== undefined ? { data: [], total: 0 } : [];

    const mergedWhere: Prisma.StudentProfileWhereInput = {
      ...scopeWhere,
      ...(filters.classArmId ? { currentClassId: filters.classArmId } : {}),
      ...(filters.classLevelCategory ? { currentClass: { classLevel: { category: filters.classLevelCategory } } } : {}),
      ...(filters.search
        ? {
            OR: [
              { admissionNumber: { contains: filters.search, mode: "insensitive" as const } },
              { user: { firstName: { contains: filters.search, mode: "insensitive" as const } } },
              { user: { lastName: { contains: filters.search, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    };
    // An empty `where` is passed as `undefined` rather than `{}` so an
    // unscoped (Admin/school-wide) list is issued exactly as it was before
    // filters existed — same query, same call shape.
    const where = Object.keys(mergedWhere).length > 0 ? mergedWhere : undefined;

    if (filters.take === undefined) {
      return this.prisma.studentProfile.findMany({
        where,
        include: STUDENT_LIST_INCLUDE,
        orderBy: { admissionNumber: "asc" },
      });
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.studentProfile.findMany({
        where,
        include: STUDENT_LIST_INCLUDE,
        orderBy: { admissionNumber: "asc" },
        skip: filters.skip,
        take: filters.take,
      }),
      this.prisma.studentProfile.count({ where }),
    ]);
    return { data, total };
  }

  // Guardian-scoped students, unconditional on the caller's other roles —
  // unlike scopeWhereForUser's STAFF-before-PARENT priority (correct for the
  // generic roster below, wrong for "my own children"), a STAFF+PARENT user
  // must always get their real wards here regardless of what they teach.
  async myWards(userId: string) {
    const parentProfile = await this.prisma.parentProfile.findUnique({ where: { userId } });
    if (!parentProfile) return [];
    return this.prisma.studentProfile.findMany({
      where: { guardians: { some: { parentId: parentProfile.id } } },
      include: STUDENT_LIST_INCLUDE,
      orderBy: { admissionNumber: "asc" },
    });
  }

  // Resolves just the role-level `where` scope (no class/search filters, no
  // pagination) — `null` means "no rows visible to this user" so the caller
  // can short-circuit rather than issuing a `where: undefined` query that
  // would return everyone.
  private async scopeWhereForUser(user: RequestUser): Promise<Prisma.StudentProfileWhereInput | null> {
    if (user.roles.includes("SUPER_ADMIN") || user.roles.includes("ADMIN")) return {};

    if (user.roles.includes("STAFF")) {
      if (await this.hasActiveSchoolWideAssignment(user.id)) return {};
      const classArmIds = await this.activeAssignedClassArmIds(user.id);
      if (classArmIds.length === 0) return null;
      return { currentClassId: { in: classArmIds } };
    }

    if (user.roles.includes("PARENT")) {
      const parentProfile = await this.prisma.parentProfile.findUnique({ where: { userId: user.id } });
      if (!parentProfile) return null;
      return { guardians: { some: { parentId: parentProfile.id } } };
    }

    if (user.roles.includes("STUDENT")) {
      return { userId: user.id };
    }

    return null;
  }

  async findOneForUser(id: string, user: RequestUser) {
    const student = await this.prisma.studentProfile.findUniqueOrThrow({
      where: { id },
      include: {
        ...STUDENT_LIST_INCLUDE,
        guardians: { include: { parent: { include: { user: true } } } },
        // PRD §3.2: department is per-current-session (@@unique on
        // [studentId, academicSessionId]) — filtering to the singleton
        // "current" session, not currentClassId's session, matches how
        // "current" is resolved everywhere else in this codebase.
        departmentHistory: { where: { academicSession: { isCurrent: true } }, include: { department: true } },
      },
    });

    if (user.roles.includes("SUPER_ADMIN") || user.roles.includes("ADMIN")) return student;
    if (user.roles.includes("STUDENT") && student.userId === user.id) return student;

    if (user.roles.includes("PARENT")) {
      const parentProfile = await this.prisma.parentProfile.findUnique({ where: { userId: user.id } });
      if (parentProfile && student.guardians.some((g) => g.parentId === parentProfile.id)) {
        return student;
      }
    }

    if (user.roles.includes("STAFF")) {
      if (await this.hasActiveSchoolWideAssignment(user.id)) return student;
      if (student.currentClassId) {
        const classArmIds = await this.activeAssignedClassArmIds(user.id);
        if (classArmIds.includes(student.currentClassId)) return student;
      }
    }

    throw new ForbiddenException("Insufficient permissions to view this student");
  }

  private async activeAssignedClassArmIds(userId: string): Promise<string[]> {
    const staffProfile = await this.prisma.staffProfile.findUnique({ where: { userId } });
    if (!staffProfile) return [];

    const assignments = await this.prisma.staffAssignment.findMany({
      where: {
        staffId: staffProfile.id,
        isActive: true,
        assignmentType: { in: [AssignmentType.CLASS_TEACHER, AssignmentType.SUBJECT_TEACHER] },
        classArmId: { not: null },
      },
    });

    return [...new Set(assignments.map((a) => a.classArmId).filter((id): id is string => id !== null))];
  }

  private async hasActiveSchoolWideAssignment(userId: string): Promise<boolean> {
    const staffProfile = await this.prisma.staffProfile.findUnique({ where: { userId } });
    if (!staffProfile) return false;

    const count = await this.prisma.staffAssignment.count({
      where: {
        staffId: staffProfile.id,
        isActive: true,
        // BURSAR needs to find any student to attach an invoice/payment/fee
        // opt-in to (FeeStructureStudentAssignmentService) — same school-wide
        // remit shape as PRINCIPAL/HEADTEACHER/REGISTRAR, not tied to a
        // classArmId.
        assignmentType: { in: [AssignmentType.PRINCIPAL, AssignmentType.HEADTEACHER, AssignmentType.REGISTRAR, AssignmentType.BURSAR] },
      },
    });
    return count > 0;
  }
}

@Controller("students")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class StudentController {
  constructor(
    private readonly service: StudentService,
    private readonly abilityFactory: AbilityFactory,
  ) {}

  @Post()
  @CheckPolicies((ability) => ability.can("manage", "StudentProfile"))
  create(@Body() dto: CreateStudentDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: RequestUser,
    @Query("classArmId") classArmId?: string,
    @Query("classLevelCategory") classLevelCategory?: ClassLevelCategory,
    @Query("search") search?: string,
    @Query("skip") skip?: string,
    @Query("take") take?: string,
  ) {
    return this.service.findAllForUser(user, {
      classArmId,
      classLevelCategory,
      search,
      skip: skip === undefined ? undefined : Number(skip),
      take: take === undefined ? undefined : Number(take),
    });
  }

  @Get("wards")
  findWards(@CurrentUser() user: RequestUser) {
    return this.service.myWards(user.id);
  }

  @Get(":id")
  findOne(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    return this.service.findOneForUser(id, user);
  }

  @Patch(":id")
  @CheckPolicies((ability) => ability.can("manage", "StudentProfile"))
  update(@Param("id") id: string, @Body() dto: UpdateStudentDto) {
    return this.service.update(id, dto);
  }

  @Post(":id/photo")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: MAX_PHOTO_FILE_SIZE_BYTES },
      fileFilter: (_req, file, callback) => {
        if (!ALLOWED_PHOTO_MIME_TYPES.includes(file.mimetype)) {
          callback(new BadRequestException("Photo must be a JPEG, PNG, or WebP image"), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  // No @CheckPolicies here — a class teacher (no "manage StudentProfile"
  // grant at all) must reach the service to be authorized, since that's a
  // row-level "are you the class teacher for *this* student" check CASL
  // can't express at guard time. Same shape as ReportCommentController's
  // write() route. StudentService.uploadPhoto does the actual gating,
  // Admin/Super-Admin bypassing it via the isOverride computed below.
  uploadPhoto(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: RequestUser,
  ) {
    if (!file) {
      throw new BadRequestException("Photo file is required");
    }
    const ability = this.abilityFactory.createForUser(user);
    const isOverride = ability.can("manage", "StudentProfile");
    return this.service.uploadPhoto(id, file, user.id, isOverride);
  }
}
