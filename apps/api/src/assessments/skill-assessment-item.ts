import { Body, Controller, Delete, Get, Injectable, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { CreateSkillAssessmentItemDto, UpdateSkillAssessmentItemDto } from "./dto/skill-assessment-item.dto";

@Injectable()
export class SkillAssessmentItemService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * PRD FR4.5: Admin/Super-Admin configures this list once per academic
   * session. On first access for a session with zero items, copy (not
   * reference) the most recent prior session's list so the new session gets
   * its own independently-editable rows; if no prior session has any items
   * either (first-ever session), return empty — Admin builds from scratch.
   */
  async findAllForSession(academicSessionId: string) {
    const existing = await this.prisma.skillAssessmentItem.findMany({
      where: { academicSessionId },
      orderBy: [{ category: "asc" }, { order: "asc" }],
    });
    if (existing.length > 0) return existing;

    const priorSessions = await this.prisma.academicSession.findMany({
      where: { id: { not: academicSessionId } },
      orderBy: { startDate: "desc" },
      select: { id: true },
    });

    for (const session of priorSessions) {
      const priorItems = await this.prisma.skillAssessmentItem.findMany({
        where: { academicSessionId: session.id },
        orderBy: [{ category: "asc" }, { order: "asc" }],
      });
      if (priorItems.length === 0) continue;

      return this.prisma.$transaction(
        priorItems.map((item) =>
          this.prisma.skillAssessmentItem.create({
            data: {
              academicSessionId,
              category: item.category,
              name: item.name,
              order: item.order,
              isActive: item.isActive,
            },
          }),
        ),
      );
    }

    return [];
  }

  create(dto: CreateSkillAssessmentItemDto) {
    return this.prisma.skillAssessmentItem.create({ data: dto });
  }

  update(id: string, dto: UpdateSkillAssessmentItemDto) {
    return this.prisma.skillAssessmentItem.update({ where: { id }, data: dto });
  }

  remove(id: string) {
    return this.prisma.skillAssessmentItem.delete({ where: { id } });
  }
}

@Controller("skill-assessment-items")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class SkillAssessmentItemController {
  constructor(private readonly service: SkillAssessmentItemService) {}

  @Get()
  findAllForSession(@Query("academicSessionId") academicSessionId: string) {
    return this.service.findAllForSession(academicSessionId);
  }

  @Post()
  @CheckPolicies((ability) => ability.can("manage", "SkillAssessmentItem"))
  create(@Body() dto: CreateSkillAssessmentItemDto) {
    return this.service.create(dto);
  }

  @Patch(":id")
  @CheckPolicies((ability) => ability.can("manage", "SkillAssessmentItem"))
  update(@Param("id") id: string, @Body() dto: UpdateSkillAssessmentItemDto) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @CheckPolicies((ability) => ability.can("manage", "SkillAssessmentItem"))
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
