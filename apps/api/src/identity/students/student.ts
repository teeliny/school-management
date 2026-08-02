import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { AssignmentType, Prisma, Role } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { PoliciesGuard } from "../../casl/policies.guard";
import { CheckPolicies } from "../../casl/check-policies.decorator";
import { CurrentUser } from "../../auth/current-user.decorator";
import type { RequestUser } from "../../auth/jwt.strategy";
import { UserService } from "../users/user.service";
import { InvitationService } from "../invitations/invitation.service";
import { StudentSubjectEnrollmentService } from "../../subjects/student-subject-enrollment";
import { CreateStudentDto, GuardianInputDto } from "./dto/create-student.dto";
import { UpdateStudentDto } from "./dto/update-student.dto";

type Tx = Prisma.TransactionClient;

const STUDENT_LIST_INCLUDE = { user: true } satisfies Prisma.StudentProfileInclude;

@Injectable()
export class StudentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly invitationService: InvitationService,
    private readonly enrollmentService: StudentSubjectEnrollmentService,
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
  async create(dto: CreateStudentDto) {
    const pendingInvites: { email: string; rawToken: string }[] = [];

    const student = await this.prisma.$transaction(async (tx) => {
      // Students are created directly, never invited (PRD FR1.3), and are
      // frequently minors with no independent email. A synthetic,
      // non-deliverable address satisfies User.email's NOT NULL + UNIQUE
      // constraint without being usable for login — no passwordHash is ever
      // set for this path, and login requires one.
      const syntheticEmail = UserService.normalizeEmail(
        `student.${dto.admissionNumber}@no-email.internal`,
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
          admissionNumber: dto.admissionNumber,
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
      if (dto.classArmId) {
        await this.enrollmentService.syncCompulsoryEnrollmentsOnClassAssignment(tx, {
          studentId: studentProfile.id,
          classArmId: dto.classArmId,
        });
      }

      return studentProfile;
    });

    // Emails go out only after the transaction commits — a failed send
    // shouldn't roll back a real student/guardian record.
    for (const invite of pendingInvites) {
      await this.invitationService.sendInviteEmail(invite.email, invite.rawToken);
    }

    return student;
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

    const parentProfile = await tx.parentProfile.findUniqueOrThrow({ where: { userId } });
    return parentProfile.id;
  }

  // PRD §3.3: reassigning a class arm re-syncs compulsory enrollment for the
  // new class, same transaction. Known limitation, not silently fixed: this
  // does not drop enrollments tied to the student's *previous* class arm.
  update(id: string, dto: UpdateStudentDto) {
    if (!dto.classArmId) {
      return this.prisma.studentProfile.update({ where: { id }, data: dto });
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.studentProfile.update({ where: { id }, data: dto });
      await this.enrollmentService.syncCompulsoryEnrollmentsOnClassAssignment(tx, {
        studentId: id,
        classArmId: dto.classArmId!,
      });
      return updated;
    });
  }

  /**
   * PRD §5 row-level list scoping: SUPER_ADMIN/ADMIN see every student;
   * STAFF see students in class arms they hold an active CLASS_TEACHER or
   * SUBJECT_TEACHER assignment for (subject-level narrowing arrives in
   * Phase 3 once StudentSubjectEnrollment exists); PARENT see their own
   * wards; STUDENT sees only themself. This is plain Prisma `where`
   * composition, not a CASL instance check, per PRD §5's own note that
   * scoped rules need row-level checks against StaffAssignment/
   * StudentGuardian, evaluated per-request.
   */
  async findAllForUser(user: RequestUser) {
    if (user.roles.includes("SUPER_ADMIN") || user.roles.includes("ADMIN")) {
      return this.prisma.studentProfile.findMany({
        include: STUDENT_LIST_INCLUDE,
        orderBy: { admissionNumber: "asc" },
      });
    }

    if (user.roles.includes("STAFF")) {
      const classArmIds = await this.activeAssignedClassArmIds(user.id);
      if (classArmIds.length === 0) return [];
      return this.prisma.studentProfile.findMany({
        where: { currentClassId: { in: classArmIds } },
        include: STUDENT_LIST_INCLUDE,
        orderBy: { admissionNumber: "asc" },
      });
    }

    if (user.roles.includes("PARENT")) {
      const parentProfile = await this.prisma.parentProfile.findUnique({ where: { userId: user.id } });
      if (!parentProfile) return [];
      return this.prisma.studentProfile.findMany({
        where: { guardians: { some: { parentId: parentProfile.id } } },
        include: STUDENT_LIST_INCLUDE,
        orderBy: { admissionNumber: "asc" },
      });
    }

    if (user.roles.includes("STUDENT")) {
      return this.prisma.studentProfile.findMany({
        where: { userId: user.id },
        include: STUDENT_LIST_INCLUDE,
      });
    }

    return [];
  }

  async findOneForUser(id: string, user: RequestUser) {
    const student = await this.prisma.studentProfile.findUniqueOrThrow({
      where: { id },
      include: { ...STUDENT_LIST_INCLUDE, guardians: true },
    });

    if (user.roles.includes("SUPER_ADMIN") || user.roles.includes("ADMIN")) return student;
    if (user.roles.includes("STUDENT") && student.userId === user.id) return student;

    if (user.roles.includes("PARENT")) {
      const parentProfile = await this.prisma.parentProfile.findUnique({ where: { userId: user.id } });
      if (parentProfile && student.guardians.some((g) => g.parentId === parentProfile.id)) {
        return student;
      }
    }

    if (user.roles.includes("STAFF") && student.currentClassId) {
      const classArmIds = await this.activeAssignedClassArmIds(user.id);
      if (classArmIds.includes(student.currentClassId)) return student;
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
}

@Controller("students")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class StudentController {
  constructor(private readonly service: StudentService) {}

  @Post()
  @CheckPolicies((ability) => ability.can("manage", "StudentProfile"))
  create(@Body() dto: CreateStudentDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll(@CurrentUser() user: RequestUser) {
    return this.service.findAllForUser(user);
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
}
