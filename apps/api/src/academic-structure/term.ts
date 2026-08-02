import { Body, Controller, Delete, Get, Injectable, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { CreateTermDto, UpdateTermDto } from "./dto/term.dto";

@Injectable()
export class TermService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateTermDto) {
    return this.prisma.term.create({ data: dto });
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
