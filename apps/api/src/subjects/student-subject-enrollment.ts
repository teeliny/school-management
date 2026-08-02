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
import { ClassLevelCategory, ClassSubject, EnrollmentStatus, Prisma, Subject, SubjectType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { CreateEnrollmentDto } from "./dto/student-subject-enrollment.dto";

type Tx = Prisma.TransactionClient;

/**
 * PRD §3.3 applicability rules engine:
 *  - COMPULSORY: auto-applies to every student in the assigned class.
 *  - GENERAL: available to any student in the assigned class; opt-in.
 *  - DEPARTMENT: only students whose StudentDepartment matches the subject's
 *    department may enroll; only valid for ClassLevel.category = SSS.
 * `resolveEffectiveType` is the single place both the auto-enroll hook
 * (student.ts's create/update) and explicit enroll() consult, so
 * ClassSubject.isCompulsoryOverride semantics can't drift between the two.
 */
@Injectable()
export class StudentSubjectEnrollmentService {
  constructor(private readonly prisma: PrismaService) {}

  resolveEffectiveType(subject: Subject, classSubject: ClassSubject | null): SubjectType {
    if (classSubject?.isCompulsoryOverride === true) return SubjectType.COMPULSORY;
    if (classSubject?.isCompulsoryOverride === false) {
      return subject.type === SubjectType.COMPULSORY ? SubjectType.GENERAL : subject.type;
    }
    return subject.type;
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
    const classArm = await tx.classArm.findUniqueOrThrow({ where: { id: params.classArmId } });

    // No enforced "current term" concept exists yet (Term.isCurrent has no
    // singleton guarantee, unlike AcademicSession.isCurrent) — a known,
    // pre-existing gap. Without a current term to stamp, auto-enrollment is
    // a no-op rather than guessing which term applies.
    const term = await tx.term.findFirst({ where: { academicSessionId: classArm.academicSessionId, isCurrent: true } });
    if (!term) return;

    const classSubjects = await tx.classSubject.findMany({
      where: { classLevelId: classArm.classLevelId, academicSessionId: classArm.academicSessionId },
      include: { subject: true },
    });

    for (const classSubject of classSubjects) {
      const effectiveType = this.resolveEffectiveType(classSubject.subject, classSubject);
      if (effectiveType !== SubjectType.COMPULSORY) continue;

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
    const subject = await this.prisma.subject.findUniqueOrThrow({ where: { id: dto.subjectId } });
    const classArm = await this.prisma.classArm.findUniqueOrThrow({
      where: { id: dto.classArmId },
      include: { classLevel: true },
    });

    const classSubject = await this.prisma.classSubject.findUnique({
      where: {
        classLevelId_subjectId_academicSessionId: {
          classLevelId: classArm.classLevelId,
          subjectId: dto.subjectId,
          academicSessionId: dto.academicSessionId,
        },
      },
    });
    if (!classSubject) {
      throw new NotFoundException("This subject is not assigned to that class for this session");
    }

    const effectiveType = this.resolveEffectiveType(subject, classSubject);

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
      if (!studentDepartment || studentDepartment.departmentId !== subject.departmentId) {
        throw new BadRequestException("Student's department does not match this subject's department");
      }
    }

    return this.prisma.studentSubjectEnrollment.upsert({
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
