import { Body, Controller, Delete, Get, Injectable, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { AssessmentComponentStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { CreateTermDto, UpdateTermDto } from "./dto/term.dto";

@Injectable()
export class TermService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Assessment structure (CA/Mid-Term/Exam definitions) is meant to stay the
   * same term-to-term and session-to-session by default — Admin only acts
   * when it changes — so a new term carries forward the chronologically-
   * preceding term's AssessmentComponent rows (any session, not just this
   * one, same "preceding" resolution as AcademicSessionService.create's
   * ClassSubject carry-forward). Dates are intentionally NOT carried — a
   * carried-forward component starts DRAFT with no dates until Admin sets
   * them for the new term (assessment-sweep.util.ts treats a null date as
   * never eligible for auto-transition).
   */
  create(dto: CreateTermDto) {
    return this.prisma.$transaction(async (tx) => {
      const term = await tx.term.create({ data: dto });

      const previousTerm = await tx.term.findFirst({
        where: { id: { not: term.id }, startDate: { lt: term.startDate } },
        orderBy: { startDate: "desc" },
      });

      if (previousTerm) {
        const priorComponents = await tx.assessmentComponent.findMany({ where: { termId: previousTerm.id } });
        if (priorComponents.length > 0) {
          await tx.assessmentComponent.createMany({
            data: priorComponents.map((component) => ({
              termId: term.id,
              classLevelId: component.classLevelId,
              type: component.type,
              name: component.name,
              sequence: component.sequence,
              maxScore: component.maxScore,
              status: AssessmentComponentStatus.DRAFT,
              createdByUserId: component.createdByUserId,
            })),
            skipDuplicates: true,
          });
        }
      }

      return term;
    });
  }

  findAll(academicSessionId?: string) {
    return this.prisma.term.findMany({
      where: academicSessionId ? { academicSessionId } : undefined,
      orderBy: { startDate: "asc" },
    });
  }

  findOne(id: string) {
    return this.prisma.term.findUniqueOrThrow({ where: { id } });
  }

  update(id: string, dto: UpdateTermDto) {
    return this.prisma.term.update({ where: { id }, data: dto });
  }

  remove(id: string) {
    return this.prisma.term.delete({ where: { id } });
  }

  /**
   * PRD §3.2: unlike AcademicSession.isCurrent (partial-unique-index
   * enforced, ARCHITECTURE.md §6.1), Term has no DB-level singleton
   * guarantee — "current term" is scoped to one session at a time, so this
   * unsets every other term within the *same* academicSessionId before
   * setting the new one, service-layer only (same "not a DB constraint"
   * precedent used elsewhere in this codebase). Needed for
   * StudentSubjectEnrollmentService's compulsory auto-enroll hook (PRD
   * §3.3), which resolves "current term" via `isCurrent: true`.
   */
  async setCurrent(id: string) {
    const term = await this.prisma.term.findUniqueOrThrow({ where: { id } });
    return this.prisma.$transaction(async (tx) => {
      await tx.term.updateMany({
        where: { academicSessionId: term.academicSessionId, isCurrent: true },
        data: { isCurrent: false },
      });
      return tx.term.update({ where: { id }, data: { isCurrent: true } });
    });
  }
}

@Controller("terms")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class TermController {
  constructor(private readonly service: TermService) {}

  @Post()
  @CheckPolicies((ability) => ability.can("manage", "AcademicStructure"))
  create(@Body() dto: CreateTermDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll(@Query("academicSessionId") academicSessionId?: string) {
    return this.service.findAll(academicSessionId);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Patch(":id")
  @CheckPolicies((ability) => ability.can("manage", "AcademicStructure"))
  update(@Param("id") id: string, @Body() dto: UpdateTermDto) {
    return this.service.update(id, dto);
  }

  @Patch(":id/set-current")
  @CheckPolicies((ability) => ability.can("manage", "AcademicStructure"))
  setCurrent(@Param("id") id: string) {
    return this.service.setCurrent(id);
  }

  @Delete(":id")
  @CheckPolicies((ability) => ability.can("manage", "AcademicStructure"))
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
