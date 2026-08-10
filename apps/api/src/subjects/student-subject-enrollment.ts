import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { ClassLevelCategory, ClassSubject, EnrollmentStatus, Prisma, SubjectType } from "@prisma/client";
import { QUEUE_NAMES, type SubjectTermResultRecomputeJob } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { CreateEnrollmentDto } from "./dto/student-subject-enrollment.dto";
import { ClassSubjectTermStatusService } from "./class-subject-term-status";

type Tx = Prisma.TransactionClient;

/**
 * PRD §3.3 applicability rules engine:
 *  - COMPULSORY: auto-applies to every student in the assigned class.
 *  - GENERAL: available to any student in the assigned class; opt-in.
 *  - DEPARTMENT: only students whose StudentDepartment matches the
 *    ClassSubject's department may enroll; only valid for
 *    ClassLevel.category = SSS.
 * `resolveEffectiveType` is the single place both the auto-enroll hook
 * (student.ts's create/update) and explicit enroll() consult, so they can't
 * drift on how a ClassSubject's type is read.
 */
@Injectable()
export class StudentSubjectEnrollmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly classSubjectTermStatus: ClassSubjectTermStatusService,
    @InjectQueue(QUEUE_NAMES.SUBJECT_TERM_RESULT_RECOMPUTE)
    private readonly recomputeQueue: Queue<SubjectTermResultRecomputeJob>,
  ) {}

  resolveEffectiveType(classSubject: ClassSubject | null): SubjectType | null {
    return classSubject?.type ?? null;
  }

  /**
   * Class-assignment hook (PRD §3.3): called from StudentService.create/update
   * whenever a student's currentClassId is set, inside the same transaction
   * — never opens its own. Auto-creates/reactivates a StudentSubjectEnrollment
   * for every subject that resolves to COMPULSORY for that class this session.
   */
  async syncCompulsoryEnrollmentsOnClassAssignment(
    tx: Tx,
    params: { studentId: string; classArmId: string },
  ): Promise<void> {
    const classArm = await tx.classArm.findUniqueOrThrow({
      where: { id: params.classArmId },
      include: { classLevel: true },
    });

    // No enforced "current term" concept exists yet (Term.isCurrent has no
    // singleton guarantee, unlike AcademicSession.isCurrent) — a known,
    // pre-existing gap. Without a current term to stamp, auto-enrollment is
    // a no-op rather than guessing which term applies.
    const term = await tx.term.findFirst({ where: { academicSessionId: classArm.academicSessionId, isCurrent: true } });
    if (!term) return;

    const classSubjects = await tx.classSubject.findMany({
      where: { classLevelCategory: classArm.classLevel.category },
      include: { subject: true },
    });

    for (const classSubject of classSubjects) {
      if (!classSubject.subject.isActive) continue;

      const effectiveType = this.resolveEffectiveType(classSubject);
      if (effectiveType !== SubjectType.COMPULSORY) continue;

      const status = await tx.classSubjectTermStatus.findUnique({
        where: {
          classSubjectId_subjectId_termId: {
            classSubjectId: classSubject.id,
            subjectId: classSubject.subjectId,
            termId: term.id,
          },
        },
      });
      if (status && !status.isActive) continue;

      await tx.studentSubjectEnrollment.upsert({
        where: {
          studentId_subjectId_academicSessionId_termId: {
            studentId: params.studentId,
            subjectId: classSubject.subjectId,
            academicSessionId: classArm.academicSessionId,
            termId: term.id,
          },
        },
        create: {
          studentId: params.studentId,
          subjectId: classSubject.subjectId,
          classArmId: params.classArmId,
          academicSessionId: classArm.academicSessionId,
          termId: term.id,
          status: EnrollmentStatus.ACTIVE,
        },
        update: { status: EnrollmentStatus.ACTIVE, classArmId: params.classArmId },
      });
    }
  }

  /** Explicit GENERAL/DEPARTMENT opt-in (PRD FR2.5). */
  async enroll(dto: CreateEnrollmentDto) {
    const classArm = await this.prisma.classArm.findUniqueOrThrow({
      where: { id: dto.classArmId },
      include: { classLevel: true },
    });

    const classSubject = await this.prisma.classSubject.findUnique({
      where: {
        classLevelCategory_subjectId: {
          classLevelCategory: classArm.classLevel.category,
          subjectId: dto.subjectId,
        },
      },
    });
    if (!classSubject) {
      throw new NotFoundException("This subject is not assigned to that class");
    }

    const effectiveType = this.resolveEffectiveType(classSubject);

    if (effectiveType === SubjectType.COMPULSORY) {
      throw new BadRequestException(
        "Compulsory subjects auto-enroll on class assignment — they can't be opted into manually",
      );
    }

    if (effectiveType === SubjectType.DEPARTMENT) {
      if (classArm.classLevel.category !== ClassLevelCategory.SSS) {
        throw new BadRequestException("Department-restricted subjects are only available to SSS class levels");
      }
      const studentDepartment = await this.prisma.studentDepartment.findUnique({
        where: { studentId_academicSessionId: { studentId: dto.studentId, academicSessionId: dto.academicSessionId } },
      });
      if (!studentDepartment || studentDepartment.departmentId !== classSubject.departmentId) {
        throw new BadRequestException("Student's department does not match this subject's department");
      }
    }

    await this.classSubjectTermStatus.assertActiveForTerm({
      subjectId: dto.subjectId,
      classLevelCategory: classArm.classLevel.category,
      termId: dto.termId,
    });

    const enrollment = await this.prisma.studentSubjectEnrollment.upsert({
      where: {
        studentId_subjectId_academicSessionId_termId: {
          studentId: dto.studentId,
          subjectId: dto.subjectId,
          academicSessionId: dto.academicSessionId,
          termId: dto.termId,
        },
      },
      create: { ...dto, status: EnrollmentStatus.ACTIVE },
      update: { status: EnrollmentStatus.ACTIVE, classArmId: dto.classArmId },
    });

    // Fire-and-forget: refreshes SubjectTermResult for just this
    // student+subject+term immediately, rather than waiting on the next
    // assessment-schedule-sweep tick (which may not fire again for this
    // group at all — see SubjectTermResultService.recomputeForStudentSubjectTerm).
    await this.recomputeQueue.add("recompute", {
      studentId: dto.studentId,
      subjectId: dto.subjectId,
      classArmId: dto.classArmId,
      termId: dto.termId,
    });

    return enrollment;
  }

  drop(id: string) {
    return this.prisma.studentSubjectEnrollment.update({
      where: { id },
      data: { status: EnrollmentStatus.DROPPED },
    });
  }

  findForStudent(studentId: string, filters: { academicSessionId?: string; termId?: string }) {
    return this.prisma.studentSubjectEnrollment.findMany({
      where: { studentId, academicSessionId: filters.academicSessionId, termId: filters.termId },
      include: { subject: true },
      orderBy: { createdAt: "asc" },
    });
  }
}

@Controller("student-subject-enrollments")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class StudentSubjectEnrollmentController {
  constructor(private readonly service: StudentSubjectEnrollmentService) {}

  @Post()
  @CheckPolicies((ability) => ability.can("manage", "StudentSubjectEnrollment"))
  enroll(@Body() dto: CreateEnrollmentDto) {
    return this.service.enroll(dto);
  }

  @Get()
  findForStudent(
    @Query("studentId") studentId: string,
    @Query("academicSessionId") academicSessionId?: string,
    @Query("termId") termId?: string,
  ) {
    return this.service.findForStudent(studentId, { academicSessionId, termId });
  }

  @Patch(":id/drop")
  @CheckPolicies((ability) => ability.can("manage", "StudentSubjectEnrollment"))
  drop(@Param("id") id: string) {
    return this.service.drop(id);
  }
}
