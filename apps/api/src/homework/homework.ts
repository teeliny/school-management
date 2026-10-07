import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import {
  AssessmentComponentType,
  AssignmentType,
  EnrollmentStatus,
  HomeworkStatus,
  NotificationType,
  Prisma,
} from "@prisma/client";
import { formatPersonName } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { AbilityFactory } from "../casl/ability.factory";
import { StaffAssignmentService } from "../staff-assignments/staff-assignment";
import { ClassSubjectTermStatusService } from "../subjects/class-subject-term-status";
import { ClassSubjectLevelStatusService } from "../subjects/class-subject-level-status";
import { coveringEnrollmentSubjectIds } from "../subjects/student-subject-enrollment";
import { ScoreEntryService } from "../assessments/score-entry";
import { NotificationService } from "../notifications/notification";
import { STORAGE_ADAPTER, type StorageAdapter } from "../storage/storage-adapter";
import { resolvePrincipalHeadteacherCategories } from "../common/class-level-category-scope";
import { Audited } from "../audit/audited.decorator";
import type { AuditRequestOverrides } from "../audit/audit.interceptor";
import { CreateHomeworkDto, MarkHomeworkDto, SubmitHomeworkDto, UpdateHomeworkDto } from "./dto/homework.dto";

const MAX_HOMEWORK_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_FILES_PER_OWNER = 5;
const ALLOWED_HOMEWORK_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
// Signed fresh on every read (only the object key is stored), so this only
// needs to outlive one page view, not the file's whole lifetime.
const SIGNED_URL_TTL_SECONDS = 60 * 60;

const homeworkFileInterceptor = () =>
  FileInterceptor("file", {
    storage: memoryStorage(),
    limits: { fileSize: MAX_HOMEWORK_FILE_SIZE_BYTES },
    fileFilter: (_req, file, callback) => {
      if (!ALLOWED_HOMEWORK_MIME_TYPES.includes(file.mimetype)) {
        callback(new BadRequestException("File must be a PDF, Word document, or JPEG/PNG/WebP image"), false);
        return;
      }
      callback(null, true);
    },
  });

const homeworkInclude = {
  subject: { select: { id: true, name: true, code: true } },
  classArm: { select: { id: true, name: true, classLevelId: true, classLevel: { select: { name: true, category: true } } } },
  term: { select: { id: true, name: true } },
  caComponent: { select: { id: true, name: true, type: true, maxScore: true, status: true } },
  createdByUser: { select: { firstName: true, lastName: true } },
} satisfies Prisma.HomeworkInclude;

type HomeworkWithRelations = Prisma.HomeworkGetPayload<{ include: typeof homeworkInclude }>;

function safeFileName(name: string) {
  return name.replace(/[^\w.-]+/g, "_").slice(0, 120);
}

function startOfToday() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function formatDueDate(date: Date) {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * PRD §3.6a: subject-teacher homework with optional attachments, optional
 * online submission, and per-student marks/corrections visible to the
 * student and their guardians.
 *
 * Deliberately isolated from term grading (see the schema comment on
 * `Homework`): marks here never feed SubjectTermResult/TermReportCard. The
 * only bridge is `transferToGradebook`, an explicit, opt-in teacher action
 * for a homework linked to a CA-type AssessmentComponent, which writes
 * ordinary ScoreEntry rows through ScoreEntryService.enter — every gradebook
 * rule (OPEN component, assigned teacher, enrollment, bounds) still applies.
 *
 * Write access mirrors ScoreEntry: the active SUBJECT_TEACHER for that exact
 * subject+class arm, or Admin/Super-Admin as override (CASL "manage
 * Homework"). Read access: Admin/Super-Admin everything; Principal/
 * Headteacher/Vice Principal their own section; a staff member the
 * homework for their own subject+class pairs and their class-teacher arms;
 * a parent/student only published homework for subjects the student is
 * actively enrolled in, and only their own marks/submissions.
 */
@Injectable()
export class HomeworkService {
  private readonly logger = new Logger(HomeworkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly staffAssignments: StaffAssignmentService,
    private readonly classSubjectTermStatus: ClassSubjectTermStatusService,
    private readonly classSubjectLevelStatus: ClassSubjectLevelStatusService,
    private readonly scoreEntries: ScoreEntryService,
    private readonly notifications: NotificationService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  // ---------------------------------------------------------------------
  // Access helpers
  // ---------------------------------------------------------------------

  private async findOrThrow(id: string): Promise<HomeworkWithRelations> {
    const homework = await this.prisma.homework.findUnique({ where: { id }, include: homeworkInclude });
    if (!homework) throw new NotFoundException("Homework not found");
    return homework;
  }

  private async canManage(homework: { subjectId: string; classArmId: string }, user: RequestUser, isOverride: boolean) {
    if (isOverride) return true;
    const assignment = await this.staffAssignments.findActiveAssignment({
      userId: user.id,
      assignmentType: AssignmentType.SUBJECT_TEACHER,
      subjectId: homework.subjectId,
      classArmId: homework.classArmId,
    });
    return assignment !== null;
  }

  private async assertCanManage(homework: { subjectId: string; classArmId: string }, user: RequestUser, isOverride: boolean) {
    if (!(await this.canManage(homework, user, isOverride))) {
      throw new ForbiddenException("You are not the assigned subject teacher for this subject/class");
    }
  }

  /** Student ids this user sees as a guardian (PARENT) or as the student themself (STUDENT). */
  private async guardianStudentIds(user: RequestUser): Promise<string[]> {
    const ids: string[] = [];
    if (user.roles.includes("PARENT")) {
      const parent = await this.prisma.parentProfile.findUnique({
        where: { userId: user.id },
        select: { wards: { select: { studentId: true } } },
      });
      ids.push(...(parent?.wards.map((w) => w.studentId) ?? []));
    }
    if (user.roles.includes("STUDENT")) {
      const student = await this.prisma.studentProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
      if (student) ids.push(student.id);
    }
    return [...new Set(ids)];
  }

  /**
   * Staff-side read scope as a Prisma where fragment, or null for "sees
   * everything" (Admin/Super-Admin). Returns `{ OR: [] }`-equivalent
   * (undefined) when the user has no staff-side visibility at all.
   */
  private async staffReadWhere(user: RequestUser): Promise<Prisma.HomeworkWhereInput | null | undefined> {
    if (user.roles.includes("SUPER_ADMIN") || user.roles.includes("ADMIN")) return null;
    if (!user.roles.includes("STAFF")) return undefined;

    const ors: Prisma.HomeworkWhereInput[] = [{ createdByUserId: user.id }];

    const isSectionLead = ["PRINCIPAL", "HEADTEACHER", "VICE_PRINCIPAL"].some((t) => user.assignmentTypes.includes(t));
    const categories = isSectionLead ? resolvePrincipalHeadteacherCategories(user) : null;
    if (categories) {
      ors.push({ classArm: { classLevel: { category: { in: categories } } } });
    }

    const staffProfile = await this.prisma.staffProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (staffProfile) {
      const assignments = await this.prisma.staffAssignment.findMany({
        where: {
          staffId: staffProfile.id,
          isActive: true,
          assignmentType: { in: [AssignmentType.SUBJECT_TEACHER, AssignmentType.CLASS_TEACHER] },
          classArmId: { not: null },
        },
        select: { assignmentType: true, subjectId: true, classArmId: true },
      });
      for (const a of assignments) {
        if (a.assignmentType === AssignmentType.CLASS_TEACHER) {
          ors.push({ classArmId: a.classArmId! });
        } else if (a.subjectId) {
          ors.push({ subjectId: a.subjectId, classArmId: a.classArmId! });
        }
      }
    }
    return { OR: ors };
  }

  /**
   * Guardian/student read scope: published (or closed) homework whose
   * subject+class arm+term matches one of the ward's ACTIVE enrollments —
   * so an elective subject's homework only reaches the students who took it.
   */
  private async guardianReadScope(studentIds: string[], termId?: string) {
    if (studentIds.length === 0) return { where: undefined, enrollments: [] };
    const rows = await this.prisma.studentSubjectEnrollment.findMany({
      where: { studentId: { in: studentIds }, status: EnrollmentStatus.ACTIVE, ...(termId ? { termId } : {}) },
      select: {
        studentId: true,
        subjectId: true,
        classArmId: true,
        termId: true,
        subject: { select: { childSubjects: { select: { id: true } } } },
      },
    });
    // Homework is set on child subjects, but students are enrolled in the
    // group — a group enrollment covers each of its children
    // (coveringEnrollmentSubjectIds is the same rule from the child's side).
    const enrollments = rows.flatMap(({ subject, ...e }) => [
      e,
      ...subject.childSubjects.map((child) => ({ ...e, subjectId: child.id })),
    ]);
    if (enrollments.length === 0) return { where: undefined, enrollments };
    const tuples = new Map<string, Prisma.HomeworkWhereInput>();
    for (const e of enrollments) {
      tuples.set(`${e.subjectId}|${e.classArmId}|${e.termId}`, {
        subjectId: e.subjectId,
        classArmId: e.classArmId,
        termId: e.termId,
      });
    }
    const where: Prisma.HomeworkWhereInput = {
      status: { not: HomeworkStatus.DRAFT },
      OR: [...tuples.values()],
    };
    return { where, enrollments };
  }

  // ---------------------------------------------------------------------
  // Validation helpers
  // ---------------------------------------------------------------------

  private async assertValidTarget(subjectId: string, classArmId: string, termId: string) {
    const [subject, classArm, term] = await Promise.all([
      this.prisma.subject.findUniqueOrThrow({ where: { id: subjectId } }),
      this.prisma.classArm.findUniqueOrThrow({ where: { id: classArmId }, include: { classLevel: true } }),
      this.prisma.term.findUniqueOrThrow({ where: { id: termId } }),
    ]);

    // Same backstop as ScoreEntryService.enter/TimetableSlotService — a group
    // subject is never itself assignable, only its childSubjects are.
    if (subject.isGroup) {
      throw new BadRequestException("Cannot set homework against a group subject — use one of its child subjects instead");
    }
    if (term.academicSessionId !== classArm.academicSessionId) {
      throw new BadRequestException("This term doesn't belong to the class arm's academic session");
    }
    await this.classSubjectTermStatus.assertActiveForTerm({
      subjectId,
      classLevelCategory: classArm.classLevel.category,
      termId,
    });
    await this.classSubjectLevelStatus.assertActiveForClassLevel({
      subjectId,
      classLevelCategory: classArm.classLevel.category,
      classLevelId: classArm.classLevelId,
    });
    return classArm;
  }

  private async assertValidCaLink(params: {
    caComponentId: string;
    termId: string;
    subjectId: string;
    classArmId: string;
    classLevelCategory: string;
    maxScore: number | null;
    excludeHomeworkId?: string;
  }) {
    const component = await this.prisma.assessmentComponent.findUniqueOrThrow({ where: { id: params.caComponentId } });
    if (component.type !== AssessmentComponentType.CA) {
      throw new BadRequestException("Homework can only count toward a CA component, not a mid-term or exam");
    }
    if (component.termId !== params.termId || component.classLevelCategory !== params.classLevelCategory) {
      throw new BadRequestException("That CA component belongs to a different term or class group");
    }
    if (params.maxScore === null) {
      throw new BadRequestException("Set a max score on the homework before linking it to a CA");
    }
    const clash = await this.prisma.homework.findFirst({
      where: {
        caComponentId: params.caComponentId,
        subjectId: params.subjectId,
        classArmId: params.classArmId,
        ...(params.excludeHomeworkId ? { id: { not: params.excludeHomeworkId } } : {}),
      },
      select: { title: true },
    });
    if (clash) {
      throw new BadRequestException(`"${clash.title}" already counts toward ${component.name} for this subject and class`);
    }
  }

  /** ACTIVE enrollments for this homework's subject+class arm+term — the roster that can submit/be marked. */
  private async roster(homework: { subjectId: string; classArmId: string; termId: string }, studentIds?: string[]) {
    const subject = await this.prisma.subject.findUniqueOrThrow({
      where: { id: homework.subjectId },
      select: { id: true, parentSubjectId: true },
    });
    return this.prisma.studentSubjectEnrollment.findMany({
      // distinct: a student enrolled in both the group and the child appears once.
      distinct: ["studentId"],
      where: {
        subjectId: { in: coveringEnrollmentSubjectIds(subject) },
        classArmId: homework.classArmId,
        termId: homework.termId,
        status: EnrollmentStatus.ACTIVE,
        ...(studentIds ? { studentId: { in: studentIds } } : {}),
      },
      select: {
        student: {
          select: {
            id: true,
            admissionNumber: true,
            userId: true,
            user: { select: { firstName: true, lastName: true } },
            guardians: { select: { parent: { select: { userId: true } } } },
          },
        },
      },
      orderBy: [{ student: { user: { lastName: "asc" } } }, { student: { user: { firstName: "asc" } } }],
    });
  }

  private async assertOnRoster(homework: { subjectId: string; classArmId: string; termId: string }, studentId: string) {
    const [entry] = await this.roster(homework, [studentId]);
    if (!entry) {
      throw new BadRequestException("This student is not actively enrolled in this subject for this class/term");
    }
    return entry.student;
  }

  private sign(key: string) {
    return this.storage.getSignedUrl(key, SIGNED_URL_TTL_SECONDS);
  }

  private async deleteObjectSafely(key: string) {
    try {
      await this.storage.delete(key);
    } catch (error) {
      this.logger.warn(`Failed to delete storage object ${key}: ${String(error)}`);
    }
  }

  // ---------------------------------------------------------------------
  // Notifications — never let a notification failure fail the real write
  // (same contract as TermReportCardService.notifySafely).
  // ---------------------------------------------------------------------

  private async notifySafely(recipientUserId: string, type: NotificationType, vars: Record<string, string | number>) {
    try {
      await this.notifications.notify(recipientUserId, type, vars);
    } catch (error) {
      this.logger.warn(`Failed to send ${type} notification to ${recipientUserId}: ${String(error)}`);
    }
  }

  private async notifyStudentAndGuardians(
    student: { userId: string; user: { firstName: string; lastName: string }; guardians: { parent: { userId: string } }[] },
    type: NotificationType,
    vars: Record<string, string | number>,
  ) {
    const studentName = formatPersonName(student.user);
    const recipients = new Set([student.userId, ...student.guardians.map((g) => g.parent.userId)]);
    for (const userId of recipients) {
      await this.notifySafely(userId, type, { ...vars, studentName });
    }
  }

  // ---------------------------------------------------------------------
  // Homework CRUD
  // ---------------------------------------------------------------------

  async create(dto: CreateHomeworkDto, user: RequestUser, isOverride: boolean) {
    await this.assertCanManage(dto, user, isOverride);
    const classArm = await this.assertValidTarget(dto.subjectId, dto.classArmId, dto.termId);
    const maxScore = dto.maxScore ?? null;
    if (dto.caComponentId) {
      await this.assertValidCaLink({
        caComponentId: dto.caComponentId,
        termId: dto.termId,
        subjectId: dto.subjectId,
        classArmId: dto.classArmId,
        classLevelCategory: classArm.classLevel.category,
        maxScore,
      });
    }

    return this.prisma.homework.create({
      data: {
        subjectId: dto.subjectId,
        classArmId: dto.classArmId,
        termId: dto.termId,
        createdByUserId: user.id,
        title: dto.title.trim(),
        instructions: dto.instructions.trim(),
        dueDate: dto.dueDate,
        maxScore,
        allowOnlineSubmission: dto.allowOnlineSubmission ?? false,
        caComponentId: dto.caComponentId ?? null,
      },
      include: homeworkInclude,
    });
  }

  async update(id: string, dto: UpdateHomeworkDto, user: RequestUser, isOverride: boolean) {
    const homework = await this.findOrThrow(id);
    await this.assertCanManage(homework, user, isOverride);

    const currentMax = homework.maxScore === null ? null : Number(homework.maxScore);
    const nextMax = dto.maxScore === undefined ? currentMax : dto.maxScore;
    if (nextMax !== currentMax) {
      const markCount = await this.prisma.homeworkMark.count({ where: { homeworkId: id } });
      if (markCount > 0) {
        throw new BadRequestException("Can't change the max score once students have been marked");
      }
    }

    const nextCa = dto.caComponentId === undefined ? homework.caComponentId : dto.caComponentId;
    if (nextCa) {
      await this.assertValidCaLink({
        caComponentId: nextCa,
        termId: homework.termId,
        subjectId: homework.subjectId,
        classArmId: homework.classArmId,
        classLevelCategory: homework.classArm.classLevel.category,
        maxScore: nextMax,
        excludeHomeworkId: id,
      });
    }

    return this.prisma.homework.update({
      where: { id },
      data: {
        title: dto.title?.trim(),
        instructions: dto.instructions?.trim(),
        dueDate: dto.dueDate,
        maxScore: nextMax,
        allowOnlineSubmission: dto.allowOnlineSubmission,
        caComponentId: nextCa,
        // A different (or removed) CA link means the previous transfer no
        // longer describes this homework's gradebook state.
        ...(nextCa !== homework.caComponentId ? { caTransferredAt: null } : {}),
      },
      include: homeworkInclude,
    });
  }

  async remove(id: string, user: RequestUser, isOverride: boolean) {
    const homework = await this.findOrThrow(id);
    await this.assertCanManage(homework, user, isOverride);
    const [marks, submissions] = await Promise.all([
      this.prisma.homeworkMark.count({ where: { homeworkId: id } }),
      this.prisma.homeworkSubmission.count({ where: { homeworkId: id } }),
    ]);
    if (marks > 0 || submissions > 0) {
      throw new BadRequestException("Can't delete homework that already has submissions or marks — close it instead");
    }
    const attachments = await this.prisma.homeworkAttachment.findMany({ where: { homeworkId: id } });
    const deleted = await this.prisma.homework.delete({ where: { id } });
    await Promise.all(attachments.map((a) => this.deleteObjectSafely(a.storageKey)));
    return deleted;
  }

  async publish(id: string, user: RequestUser, isOverride: boolean) {
    const homework = await this.findOrThrow(id);
    await this.assertCanManage(homework, user, isOverride);
    if (homework.status === HomeworkStatus.PUBLISHED) {
      throw new BadRequestException("This homework is already published");
    }
    const isFirstPublish = homework.publishedAt === null;
    const updated = await this.prisma.homework.update({
      where: { id },
      data: { status: HomeworkStatus.PUBLISHED, publishedAt: homework.publishedAt ?? new Date() },
      include: homeworkInclude,
    });

    // Reopening a CLOSED homework doesn't re-announce it. Not awaited: a
    // class of ~40 students × guardians is a lot of sequential notify()
    // calls to hold the HTTP response for.
    if (isFirstPublish) {
      void this.notifyAssigned(updated);
    }
    return updated;
  }

  private async notifyAssigned(homework: HomeworkWithRelations) {
    try {
      const roster = await this.roster(homework);
      for (const { student } of roster) {
        await this.notifyStudentAndGuardians(student, NotificationType.HOMEWORK_ASSIGNED, {
          subjectName: homework.subject.name,
          homeworkTitle: homework.title,
          dueDate: formatDueDate(homework.dueDate),
        });
      }
    } catch (error) {
      this.logger.warn(`Failed to fan out HOMEWORK_ASSIGNED for ${homework.id}: ${String(error)}`);
    }
  }

  async close(id: string, user: RequestUser, isOverride: boolean) {
    const homework = await this.findOrThrow(id);
    await this.assertCanManage(homework, user, isOverride);
    if (homework.status !== HomeworkStatus.PUBLISHED) {
      throw new BadRequestException("Only a published homework can be closed");
    }
    return this.prisma.homework.update({ where: { id }, data: { status: HomeworkStatus.CLOSED }, include: homeworkInclude });
  }

  // ---------------------------------------------------------------------
  // Attachments (teacher-provided files)
  // ---------------------------------------------------------------------

  async addAttachment(id: string, file: Express.Multer.File, user: RequestUser, isOverride: boolean) {
    const homework = await this.findOrThrow(id);
    await this.assertCanManage(homework, user, isOverride);
    const count = await this.prisma.homeworkAttachment.count({ where: { homeworkId: id } });
    if (count >= MAX_FILES_PER_OWNER) {
      throw new BadRequestException(`A homework can have at most ${MAX_FILES_PER_OWNER} attachments`);
    }
    const key = `homework/${id}/attachments/${Date.now()}-${safeFileName(file.originalname)}`;
    await this.storage.put(key, file.buffer, file.mimetype);
    return this.prisma.homeworkAttachment.create({
      data: { homeworkId: id, storageKey: key, fileName: file.originalname, mimeType: file.mimetype, sizeBytes: file.size },
    });
  }

  async removeAttachment(id: string, attachmentId: string, user: RequestUser, isOverride: boolean) {
    const homework = await this.findOrThrow(id);
    await this.assertCanManage(homework, user, isOverride);
    const attachment = await this.prisma.homeworkAttachment.findFirst({ where: { id: attachmentId, homeworkId: id } });
    if (!attachment) throw new NotFoundException("Attachment not found");
    await this.prisma.homeworkAttachment.delete({ where: { id: attachmentId } });
    await this.deleteObjectSafely(attachment.storageKey);
    return attachment;
  }

  // ---------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------

  async findAll(
    user: RequestUser,
    filters: { classArmId?: string; subjectId?: string; termId?: string; studentId?: string; status?: HomeworkStatus },
  ) {
    const staffWhere = await this.staffReadWhere(user);
    let wardIds = await this.guardianStudentIds(user);
    if (filters.studentId) wardIds = wardIds.filter((id) => id === filters.studentId);
    const guardian = await this.guardianReadScope(wardIds, filters.termId);

    const scopes: Prisma.HomeworkWhereInput[] = [];
    if (staffWhere === null) scopes.push({});
    else if (staffWhere) scopes.push(staffWhere);
    if (guardian.where) scopes.push(guardian.where);
    if (scopes.length === 0) return [];

    // studentId only narrows the guardian scope above — it isn't a Homework column.
    const scalarFilters = { classArmId: filters.classArmId, subjectId: filters.subjectId, termId: filters.termId, status: filters.status };
    const homework = await this.prisma.homework.findMany({
      where: { AND: [{ OR: scopes }, scalarFilters] },
      include: {
        ...homeworkInclude,
        _count: { select: { marks: true, submissions: true, attachments: true } },
        marks: { where: { studentId: { in: wardIds } }, select: { studentId: true, score: true, markedAt: true } },
        submissions: {
          where: { studentId: { in: wardIds } },
          select: { studentId: true, submittedAt: true, isLate: true },
        },
      },
      orderBy: [{ dueDate: "desc" }, { createdAt: "desc" }],
    });

    // For the guardian/student view, which of the viewer's own students
    // each homework applies to (a parent with two wards in different classes
    // sees each homework once, tagged with the right child).
    const wardTuples = guardian.enrollments;
    return homework.map((h) => ({
      ...h,
      wardStudentIds: [
        ...new Set(
          wardTuples
            .filter((e) => e.subjectId === h.subjectId && e.classArmId === h.classArmId && e.termId === h.termId)
            .map((e) => e.studentId),
        ),
      ],
    }));
  }

  async findOne(id: string, user: RequestUser, isOverride: boolean) {
    const homework = await this.findOrThrow(id);
    const canManage = await this.canManage(homework, user, isOverride);

    let visibleStudentIds: string[] | undefined;
    if (!canManage) {
      const staffWhere = await this.staffReadWhere(user);
      const staffCanRead =
        staffWhere === null ||
        (staffWhere !== undefined &&
          (await this.prisma.homework.count({ where: { AND: [{ id }, staffWhere] } })) > 0);
      if (!staffCanRead) {
        // Guardian/student view: only published homework, only their own students.
        const wardIds = await this.guardianStudentIds(user);
        if (homework.status === HomeworkStatus.DRAFT || wardIds.length === 0) {
          throw new NotFoundException("Homework not found");
        }
        visibleStudentIds = wardIds;
      }
    }

    const [roster, attachments, submissions, marks] = await Promise.all([
      this.roster(homework, visibleStudentIds),
      this.prisma.homeworkAttachment.findMany({ where: { homeworkId: id }, orderBy: { uploadedAt: "asc" } }),
      this.prisma.homeworkSubmission.findMany({
        where: { homeworkId: id, ...(visibleStudentIds ? { studentId: { in: visibleStudentIds } } : {}) },
        include: { files: { orderBy: { uploadedAt: "asc" } } },
      }),
      this.prisma.homeworkMark.findMany({
        where: { homeworkId: id, ...(visibleStudentIds ? { studentId: { in: visibleStudentIds } } : {}) },
      }),
    ]);
    if (visibleStudentIds && roster.length === 0) {
      throw new NotFoundException("Homework not found");
    }

    const submissionByStudent = new Map(submissions.map((s) => [s.studentId, s]));
    const markByStudent = new Map(marks.map((m) => [m.studentId, m]));

    return {
      ...homework,
      viewerCanManage: canManage,
      attachments: await Promise.all(
        attachments.map(async ({ storageKey, ...a }) => ({ ...a, url: await this.sign(storageKey) })),
      ),
      roster: await Promise.all(
        roster.map(async ({ student }) => {
          const submission = submissionByStudent.get(student.id);
          const mark = markByStudent.get(student.id);
          return {
            student: {
              id: student.id,
              admissionNumber: student.admissionNumber,
              firstName: student.user.firstName,
              lastName: student.user.lastName,
            },
            submission: submission
              ? {
                  id: submission.id,
                  text: submission.text,
                  isLate: submission.isLate,
                  submittedAt: submission.submittedAt,
                  updatedAt: submission.updatedAt,
                  files: await Promise.all(
                    submission.files.map(async ({ storageKey, ...f }) => ({ ...f, url: await this.sign(storageKey) })),
                  ),
                }
              : null,
            mark: mark
              ? {
                  id: mark.id,
                  score: mark.score,
                  correction: mark.correction,
                  correctionFileName: mark.correctionFileName,
                  correctionUrl: mark.correctionStorageKey ? await this.sign(mark.correctionStorageKey) : null,
                  markedAt: mark.markedAt,
                  updatedAt: mark.updatedAt,
                  changedSinceTransfer:
                    homework.caTransferredAt !== null && mark.updatedAt > homework.caTransferredAt,
                }
              : null,
          };
        }),
      ),
    };
  }

  // ---------------------------------------------------------------------
  // Marking
  // ---------------------------------------------------------------------

  async mark(id: string, studentId: string, dto: MarkHomeworkDto, user: RequestUser, isOverride: boolean) {
    const homework = await this.findOrThrow(id);
    await this.assertCanManage(homework, user, isOverride);
    if (homework.status === HomeworkStatus.DRAFT) {
      throw new BadRequestException("Publish this homework before marking it");
    }
    const student = await this.assertOnRoster(homework, studentId);

    const max = homework.maxScore === null ? null : Number(homework.maxScore);
    const score = dto.score ?? null;
    if (max === null && score !== null) {
      throw new BadRequestException("This homework has no max score — leave the score empty and add a correction");
    }
    if (max !== null && score === null) {
      throw new BadRequestException("Enter a score for this homework");
    }
    if (max !== null && score !== null && score > max) {
      throw new BadRequestException(`Score cannot exceed this homework's max score of ${max}`);
    }
    const correction = dto.correction?.trim() || null;

    const where = { homeworkId_studentId: { homeworkId: id, studentId } };
    const before = await this.prisma.homeworkMark.findUnique({ where });
    const mark = await this.prisma.homeworkMark.upsert({
      where,
      create: { homeworkId: id, studentId, score, correction, markedByUserId: user.id },
      update: { score, correction, markedByUserId: user.id },
    });

    await this.notifyStudentAndGuardians(student, NotificationType.HOMEWORK_MARKED, {
      subjectName: homework.subject.name,
      homeworkTitle: homework.title,
      scoreText: score !== null && max !== null ? ` — ${score}/${max}` : "",
    });

    return { mark, before };
  }

  async uploadCorrectionFile(id: string, studentId: string, file: Express.Multer.File, user: RequestUser, isOverride: boolean) {
    const homework = await this.findOrThrow(id);
    await this.assertCanManage(homework, user, isOverride);
    const mark = await this.prisma.homeworkMark.findUnique({ where: { homeworkId_studentId: { homeworkId: id, studentId } } });
    if (!mark) throw new BadRequestException("Save a mark for this student before attaching a correction file");

    const key = `homework/${id}/corrections/${studentId}/${Date.now()}-${safeFileName(file.originalname)}`;
    await this.storage.put(key, file.buffer, file.mimetype);
    const updated = await this.prisma.homeworkMark.update({
      where: { id: mark.id },
      data: { correctionStorageKey: key, correctionFileName: file.originalname, correctionMimeType: file.mimetype },
    });
    if (mark.correctionStorageKey) await this.deleteObjectSafely(mark.correctionStorageKey);
    return updated;
  }

  async removeCorrectionFile(id: string, studentId: string, user: RequestUser, isOverride: boolean) {
    const homework = await this.findOrThrow(id);
    await this.assertCanManage(homework, user, isOverride);
    const mark = await this.prisma.homeworkMark.findUnique({ where: { homeworkId_studentId: { homeworkId: id, studentId } } });
    if (!mark?.correctionStorageKey) throw new NotFoundException("No correction file to remove");
    const updated = await this.prisma.homeworkMark.update({
      where: { id: mark.id },
      data: { correctionStorageKey: null, correctionFileName: null, correctionMimeType: null },
    });
    await this.deleteObjectSafely(mark.correctionStorageKey);
    return updated;
  }

  // ---------------------------------------------------------------------
  // Online submission (opt-in per homework via allowOnlineSubmission)
  // ---------------------------------------------------------------------

  private async assertCanSubmit(homework: HomeworkWithRelations, studentId: string, user: RequestUser) {
    const ownStudentIds = await this.guardianStudentIds(user);
    if (!ownStudentIds.includes(studentId)) {
      throw new ForbiddenException("You can only submit work for yourself or your own ward");
    }
    if (!homework.allowOnlineSubmission) {
      throw new BadRequestException("This homework doesn't accept online submissions");
    }
    if (homework.status !== HomeworkStatus.PUBLISHED) {
      throw new BadRequestException("This homework is no longer accepting submissions");
    }
    const student = await this.assertOnRoster(homework, studentId);
    const mark = await this.prisma.homeworkMark.findUnique({
      where: { homeworkId_studentId: { homeworkId: homework.id, studentId } },
      select: { id: true },
    });
    if (mark) {
      throw new BadRequestException("This work has already been marked and can no longer be changed");
    }
    return student;
  }

  private async upsertSubmission(homework: HomeworkWithRelations, studentId: string, user: RequestUser, text?: string | null) {
    const where = { homeworkId_studentId: { homeworkId: homework.id, studentId } };
    const existing = await this.prisma.homeworkSubmission.findUnique({ where });
    const isLate = startOfToday() > homework.dueDate;
    const submission = await this.prisma.homeworkSubmission.upsert({
      where,
      create: { homeworkId: homework.id, studentId, submittedByUserId: user.id, text: text ?? null, isLate },
      update: { submittedByUserId: user.id, isLate, ...(text !== undefined ? { text } : {}) },
    });
    return { submission, isNew: existing === null };
  }

  private async notifyTeachersOfSubmission(homework: HomeworkWithRelations, studentName: string) {
    const teachers = await this.prisma.staffAssignment.findMany({
      where: {
        assignmentType: AssignmentType.SUBJECT_TEACHER,
        subjectId: homework.subjectId,
        classArmId: homework.classArmId,
        isActive: true,
      },
      select: { staff: { select: { userId: true } } },
    });
    const recipients = new Set(teachers.map((t) => t.staff.userId));
    for (const userId of recipients) {
      await this.notifySafely(userId, NotificationType.HOMEWORK_SUBMITTED, {
        studentName,
        homeworkTitle: homework.title,
        subjectName: homework.subject.name,
        classArmName: `${homework.classArm.classLevel.name} ${homework.classArm.name}`,
      });
    }
  }

  async submit(id: string, studentId: string, dto: SubmitHomeworkDto, user: RequestUser) {
    const homework = await this.findOrThrow(id);
    const student = await this.assertCanSubmit(homework, studentId, user);
    const { submission, isNew } = await this.upsertSubmission(homework, studentId, user, dto.text?.trim() || null);
    if (isNew) {
      await this.notifyTeachersOfSubmission(homework, formatPersonName(student.user));
    }
    return submission;
  }

  async addSubmissionFile(id: string, studentId: string, file: Express.Multer.File, user: RequestUser) {
    const homework = await this.findOrThrow(id);
    const student = await this.assertCanSubmit(homework, studentId, user);
    const { submission, isNew } = await this.upsertSubmission(homework, studentId, user);
    const count = await this.prisma.homeworkSubmissionFile.count({ where: { submissionId: submission.id } });
    if (count >= MAX_FILES_PER_OWNER) {
      throw new BadRequestException(`A submission can have at most ${MAX_FILES_PER_OWNER} files`);
    }
    const key = `homework/${id}/submissions/${studentId}/${Date.now()}-${safeFileName(file.originalname)}`;
    await this.storage.put(key, file.buffer, file.mimetype);
    const created = await this.prisma.homeworkSubmissionFile.create({
      data: { submissionId: submission.id, storageKey: key, fileName: file.originalname, mimeType: file.mimetype, sizeBytes: file.size },
    });
    if (isNew) {
      await this.notifyTeachersOfSubmission(homework, formatPersonName(student.user));
    }
    return created;
  }

  async removeSubmissionFile(id: string, studentId: string, fileId: string, user: RequestUser) {
    const homework = await this.findOrThrow(id);
    await this.assertCanSubmit(homework, studentId, user);
    const file = await this.prisma.homeworkSubmissionFile.findFirst({
      where: { id: fileId, submission: { homeworkId: id, studentId } },
    });
    if (!file) throw new NotFoundException("File not found");
    await this.prisma.homeworkSubmissionFile.delete({ where: { id: fileId } });
    await this.deleteObjectSafely(file.storageKey);
    return file;
  }

  // ---------------------------------------------------------------------
  // CA transfer — the one opt-in bridge into term grading
  // ---------------------------------------------------------------------

  private async buildTransferPlan(homework: HomeworkWithRelations) {
    if (!homework.caComponent || homework.maxScore === null) {
      throw new BadRequestException("This homework isn't linked to a CA component");
    }
    const component = homework.caComponent;
    const hwMax = Number(homework.maxScore);
    const caMax = Number(component.maxScore);

    const [roster, marks, existing] = await Promise.all([
      this.roster(homework),
      this.prisma.homeworkMark.findMany({ where: { homeworkId: homework.id } }),
      this.prisma.scoreEntry.findMany({
        where: { subjectId: homework.subjectId, assessmentComponentId: component.id, classArmId: homework.classArmId },
        select: { studentId: true, score: true, sourceHomeworkId: true },
      }),
    ]);
    const markByStudent = new Map(marks.map((m) => [m.studentId, m]));
    const existingByStudent = new Map(existing.map((e) => [e.studentId, e]));

    const rows: {
      studentId: string;
      studentName: string;
      homeworkScore: number;
      scaledScore: number;
      existingScore: number | null;
      existingFromThisHomework: boolean;
    }[] = [];
    const unmarked: { studentId: string; studentName: string }[] = [];

    for (const { student } of roster) {
      const studentName = formatPersonName(student.user);
      const mark = markByStudent.get(student.id);
      if (!mark || mark.score === null) {
        unmarked.push({ studentId: student.id, studentName });
        continue;
      }
      const homeworkScore = Number(mark.score);
      const scaledScore = Math.min(caMax, Math.round((homeworkScore / hwMax) * caMax * 100) / 100);
      const prior = existingByStudent.get(student.id);
      rows.push({
        studentId: student.id,
        studentName,
        homeworkScore,
        scaledScore,
        existingScore: prior ? Number(prior.score) : null,
        existingFromThisHomework: prior?.sourceHomeworkId === homework.id,
      });
    }

    return {
      component: { id: component.id, name: component.name, maxScore: caMax, status: component.status },
      homeworkMaxScore: hwMax,
      rows,
      unmarked,
    };
  }

  async transferPreview(id: string, user: RequestUser, isOverride: boolean) {
    const homework = await this.findOrThrow(id);
    await this.assertCanManage(homework, user, isOverride);
    return this.buildTransferPlan(homework);
  }

  async transferToGradebook(id: string, user: RequestUser, isOverride: boolean, isScoreOverride: boolean) {
    const homework = await this.findOrThrow(id);
    await this.assertCanManage(homework, user, isOverride);
    const plan = await this.buildTransferPlan(homework);
    if (plan.rows.length === 0) {
      throw new BadRequestException("No marked students to transfer yet");
    }

    // Row-by-row through ScoreEntryService.enter so every gradebook rule
    // applies exactly as a manual entry would. Its checks that could fail
    // (component OPEN, subject teacher, disabled subject) are the same for
    // every row, so in practice the first row fails before anything is
    // written; enrollment can't fail since rows come from the same roster.
    for (const row of plan.rows) {
      await this.scoreEntries.enter(
        {
          studentId: row.studentId,
          subjectId: homework.subjectId,
          assessmentComponentId: plan.component.id,
          classArmId: homework.classArmId,
          score: row.scaledScore,
        },
        user,
        isScoreOverride,
        homework.id,
      );
    }

    await this.prisma.homework.update({ where: { id }, data: { caTransferredAt: new Date() } });
    return {
      component: plan.component,
      transferred: plan.rows.length,
      skippedUnmarked: plan.unmarked.length,
    };
  }
}

@Controller("homework")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class HomeworkController {
  constructor(
    private readonly service: HomeworkService,
    private readonly abilityFactory: AbilityFactory,
  ) {}

  // No @CheckPolicies on any route — same shape as ScoreEntryController:
  // a subject teacher has no "manage Homework" grant, so authorization is
  // the row-level "are you the assigned subject teacher for this subject+
  // class" check in the service, with Admin/Super-Admin bypassing it via
  // the isOverride computed here.
  private isOverride(user: RequestUser) {
    return this.abilityFactory.createForUser(user).can("manage", "Homework");
  }

  @Get()
  findAll(
    @CurrentUser() user: RequestUser,
    @Query("classArmId") classArmId?: string,
    @Query("subjectId") subjectId?: string,
    @Query("termId") termId?: string,
    @Query("studentId") studentId?: string,
    @Query("status") status?: HomeworkStatus,
  ) {
    if (status && !Object.values(HomeworkStatus).includes(status)) {
      throw new BadRequestException("Invalid status");
    }
    return this.service.findAll(user, { classArmId, subjectId, termId, studentId, status });
  }

  @Get(":id")
  findOne(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    return this.service.findOne(id, user, this.isOverride(user));
  }

  @Post()
  @Audited("Homework", "homework")
  create(@Body() dto: CreateHomeworkDto, @CurrentUser() user: RequestUser) {
    return this.service.create(dto, user, this.isOverride(user));
  }

  @Patch(":id")
  @Audited("Homework", "homework")
  update(@Param("id") id: string, @Body() dto: UpdateHomeworkDto, @CurrentUser() user: RequestUser) {
    return this.service.update(id, dto, user, this.isOverride(user));
  }

  @Delete(":id")
  @Audited("Homework", "homework")
  remove(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    return this.service.remove(id, user, this.isOverride(user));
  }

  @Post(":id/publish")
  @Audited("Homework", "homework")
  publish(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    return this.service.publish(id, user, this.isOverride(user));
  }

  @Post(":id/close")
  @Audited("Homework", "homework")
  close(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    return this.service.close(id, user, this.isOverride(user));
  }

  @Post(":id/attachments")
  @UseInterceptors(homeworkFileInterceptor())
  @Audited("HomeworkAttachment")
  addAttachment(@Param("id") id: string, @UploadedFile() file: Express.Multer.File, @CurrentUser() user: RequestUser) {
    if (!file) throw new BadRequestException("File is required");
    return this.service.addAttachment(id, file, user, this.isOverride(user));
  }

  @Delete(":id/attachments/:attachmentId")
  @Audited("HomeworkAttachment")
  removeAttachment(@Param("id") id: string, @Param("attachmentId") attachmentId: string, @CurrentUser() user: RequestUser) {
    return this.service.removeAttachment(id, attachmentId, user, this.isOverride(user));
  }

  // Composite natural key (homework+student) upsert — same "tell the audit
  // interceptor whether this was a first mark or a correction" override as
  // ScoreEntryController.enter.
  @Put(":id/marks/:studentId")
  @Audited("HomeworkMark")
  async mark(
    @Param("id") id: string,
    @Param("studentId") studentId: string,
    @Body() dto: MarkHomeworkDto,
    @CurrentUser() user: RequestUser,
    @Req() request: AuditRequestOverrides,
  ) {
    const { mark, before } = await this.service.mark(id, studentId, dto, user, this.isOverride(user));
    request.auditAction = before ? "UPDATE" : "CREATE";
    request.auditBefore = before;
    return mark;
  }

  @Post(":id/marks/:studentId/correction-file")
  @UseInterceptors(homeworkFileInterceptor())
  @Audited("HomeworkMark")
  uploadCorrectionFile(
    @Param("id") id: string,
    @Param("studentId") studentId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: RequestUser,
  ) {
    if (!file) throw new BadRequestException("File is required");
    return this.service.uploadCorrectionFile(id, studentId, file, user, this.isOverride(user));
  }

  @Delete(":id/marks/:studentId/correction-file")
  @Audited("HomeworkMark")
  removeCorrectionFile(@Param("id") id: string, @Param("studentId") studentId: string, @CurrentUser() user: RequestUser) {
    return this.service.removeCorrectionFile(id, studentId, user, this.isOverride(user));
  }

  @Put(":id/submissions/:studentId")
  @Audited("HomeworkSubmission")
  submit(
    @Param("id") id: string,
    @Param("studentId") studentId: string,
    @Body() dto: SubmitHomeworkDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.submit(id, studentId, dto, user);
  }

  @Post(":id/submissions/:studentId/files")
  @UseInterceptors(homeworkFileInterceptor())
  @Audited("HomeworkSubmission")
  addSubmissionFile(
    @Param("id") id: string,
    @Param("studentId") studentId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: RequestUser,
  ) {
    if (!file) throw new BadRequestException("File is required");
    return this.service.addSubmissionFile(id, studentId, file, user);
  }

  @Delete(":id/submissions/:studentId/files/:fileId")
  @Audited("HomeworkSubmission")
  removeSubmissionFile(
    @Param("id") id: string,
    @Param("studentId") studentId: string,
    @Param("fileId") fileId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.removeSubmissionFile(id, studentId, fileId, user);
  }

  @Get(":id/transfer-preview")
  transferPreview(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    return this.service.transferPreview(id, user, this.isOverride(user));
  }

  @Post(":id/transfer")
  @Audited("Homework")
  transfer(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    const ability = this.abilityFactory.createForUser(user);
    return this.service.transferToGradebook(
      id,
      user,
      ability.can("manage", "Homework"),
      ability.can("manage", "ScoreEntry"),
    );
  }
}
