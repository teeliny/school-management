import { BadRequestException, Controller, Injectable, NotFoundException, Param, Patch, UseGuards } from "@nestjs/common";
import { ClassLevelCategory, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";

type Tx = Prisma.TransactionClient | PrismaService;

// Per-term disable/enable for a subject already assigned to a class via
// ClassSubject (PRD: Admin can disable a subject — or a grouped subject's
// child — for one class in one term without touching the session-wide
// assignment or any other term). Absence of a row means active.
@Injectable()
export class ClassSubjectTermStatusService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveClassSubjectAndSubject(classSubjectId: string, subjectId: string) {
    const classSubject = await this.prisma.classSubject.findUnique({ where: { id: classSubjectId } });
    if (!classSubject) throw new NotFoundException("Class-subject assignment not found");

    const subject = await this.prisma.subject.findUnique({ where: { id: subjectId } });
    if (!subject) throw new NotFoundException("Subject not found");

    // subjectId must be the assignment's own subject, or one of its group children.
    const classSubjectSubjectId = subject.parentSubjectId ?? subject.id;
    if (classSubjectSubjectId !== classSubject.subjectId) {
      throw new BadRequestException("Subject does not belong to this class-subject assignment");
    }

    return { classSubject, subject };
  }

  async setStatus(
    params: { classSubjectId: string; subjectId: string; termId: string },
    isActive: boolean,
    userId: string,
  ) {
    await this.resolveClassSubjectAndSubject(params.classSubjectId, params.subjectId);

    // No academicSessionId on ClassSubject to cross-check against — it's not
    // session-scoped (see schema.prisma), so any term can have its status
    // toggled here, regardless of which session it belongs to.
    await this.prisma.term.findUniqueOrThrow({ where: { id: params.termId } });

    return this.prisma.classSubjectTermStatus.upsert({
      where: {
        classSubjectId_subjectId_termId: {
          classSubjectId: params.classSubjectId,
          subjectId: params.subjectId,
          termId: params.termId,
        },
      },
      create: {
        classSubjectId: params.classSubjectId,
        subjectId: params.subjectId,
        termId: params.termId,
        isActive,
        disabledAt: isActive ? null : new Date(),
        disabledByUserId: isActive ? null : userId,
      },
      update: {
        isActive,
        disabledAt: isActive ? null : new Date(),
        disabledByUserId: isActive ? null : userId,
      },
    });
  }

  findForClassSubject(classSubjectId: string) {
    return this.prisma.classSubjectTermStatus.findMany({
      where: { classSubjectId },
      include: { term: true, subject: true },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Consulted by ScoreEntryService and StudentSubjectEnrollmentService
   * before creating/upserting a record: a no-op if the subject is
   * unaffected, a hard block if it's disabled either catalogue-wide
   * (Subject.isActive) or for this specific class+term
   * (ClassSubjectTermStatus).
   */
  async assertActiveForTerm(
    params: { subjectId: string; classLevelCategory: ClassLevelCategory; termId: string },
    tx: Tx = this.prisma,
  ): Promise<void> {
    const subject = await tx.subject.findUnique({ where: { id: params.subjectId } });
    if (!subject) return;

    if (!subject.isActive) {
      throw new BadRequestException(`${subject.name} is disabled`);
    }

    const classSubjectSubjectId = subject.parentSubjectId ?? subject.id;
    const classSubject = await tx.classSubject.findUnique({
      where: {
        classLevelCategory_subjectId: {
          classLevelCategory: params.classLevelCategory,
          subjectId: classSubjectSubjectId,
        },
      },
    });
    if (!classSubject) return;

    const status = await tx.classSubjectTermStatus.findUnique({
      where: {
        classSubjectId_subjectId_termId: {
          classSubjectId: classSubject.id,
          subjectId: params.subjectId,
          termId: params.termId,
        },
      },
    });
    if (status && !status.isActive) {
      throw new BadRequestException(`${subject.name} is disabled for this class for this term`);
    }
  }
}

@Controller("class-subjects/:id/terms/:termId/subjects/:subjectId")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class ClassSubjectTermStatusController {
  constructor(private readonly service: ClassSubjectTermStatusService) {}

  @Patch("disable")
  @CheckPolicies((ability) => ability.can("manage", "ClassSubject"))
  disable(
    @Param("id") id: string,
    @Param("termId") termId: string,
    @Param("subjectId") subjectId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.setStatus({ classSubjectId: id, subjectId, termId }, false, user.id);
  }

  @Patch("enable")
  @CheckPolicies((ability) => ability.can("manage", "ClassSubject"))
  enable(
    @Param("id") id: string,
    @Param("termId") termId: string,
    @Param("subjectId") subjectId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.setStatus({ classSubjectId: id, subjectId, termId }, true, user.id);
  }
}
