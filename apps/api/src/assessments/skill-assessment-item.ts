import { Body, Controller, Delete, Get, Injectable, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ClassLevelCategory, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { CreateSkillAssessmentItemDto, UpdateSkillAssessmentItemDto } from "./dto/skill-assessment-item.dto";

const ITEM_INCLUDE = { group: { include: { classLevelCategories: true } } } satisfies Prisma.SkillAssessmentItemInclude;

@Injectable()
export class SkillAssessmentItemService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * PRD FR4.5: Admin/Super-Admin configures this list once per academic
   * session. On first access for a session with zero items, copy (not
   * reference) the most recent prior session's list — including the
   * SkillGroup each item belongs to (find-or-create an equivalent group by
   * name in the new session, since SkillGroup is itself session-scoped) —
   * so the new session gets its own independently-editable rows; if no
   * prior session has any items either (first-ever session), return empty —
   * Admin builds from scratch. classLevelCategory, when given, narrows the
   * result to items whose group is applicable to that category — either
   * unrestricted or explicitly restricted to include it (PRD: e.g.
   * Reception's "Numbers"/"Letters" groups shouldn't appear on a JSS
   * class's rating form).
   */
  async findAllForSession(academicSessionId: string, classLevelCategory?: ClassLevelCategory) {
    // Whether to copy from a prior session is decided unfiltered — "this
    // session has zero items at all yet," not "zero items match this
    // category" — otherwise a classLevelCategory-filtered call against an
    // already-populated session (just with nothing matching that category)
    // would re-copy the prior session's items on top of the existing ones
    // and collide with the (groupId, name) unique constraint.
    const hasAnyItem = await this.prisma.skillAssessmentItem.count({ where: { academicSessionId } });
    if (hasAnyItem === 0) {
      await this.copyFromMostRecentPriorSession(academicSessionId);
    }

    return this.prisma.skillAssessmentItem.findMany({
      where: {
        academicSessionId,
        ...(classLevelCategory
          ? {
              group: {
                OR: [{ classLevelCategories: { none: {} } }, { classLevelCategories: { some: { classLevelCategory } } }],
              },
            }
          : {}),
      },
      include: ITEM_INCLUDE,
      orderBy: [{ group: { order: "asc" } }, { order: "asc" }],
    });
  }

  private async copyFromMostRecentPriorSession(academicSessionId: string): Promise<void> {
    const priorSessions = await this.prisma.academicSession.findMany({
      where: { id: { not: academicSessionId } },
      orderBy: { startDate: "desc" },
      select: { id: true },
    });

    for (const session of priorSessions) {
      const priorItems = await this.prisma.skillAssessmentItem.findMany({
        where: { academicSessionId: session.id },
        include: ITEM_INCLUDE,
        orderBy: [{ group: { order: "asc" } }, { order: "asc" }],
      });
      if (priorItems.length === 0) continue;

      // One group per distinct name, found-or-created in the new session —
      // several items typically share a group, so this dedupes to avoid
      // colliding with the (academicSessionId, name) unique constraint on
      // SkillGroup itself.
      const newGroupIdByName = new Map<string, string>();
      for (const item of priorItems) {
        if (newGroupIdByName.has(item.group.name)) continue;
        const newGroup = await this.prisma.skillGroup.upsert({
          where: { academicSessionId_name: { academicSessionId, name: item.group.name } },
          update: {},
          create: {
            academicSessionId,
            name: item.group.name,
            order: item.group.order,
            valueType: item.group.valueType,
            isActive: item.group.isActive,
            classLevelCategories: {
              create: item.group.classLevelCategories.map((c) => ({ classLevelCategory: c.classLevelCategory })),
            },
          },
        });
        newGroupIdByName.set(item.group.name, newGroup.id);
      }

      await this.prisma.$transaction(
        priorItems.map((item) =>
          this.prisma.skillAssessmentItem.create({
            data: {
              academicSessionId,
              groupId: newGroupIdByName.get(item.group.name)!,
              name: item.name,
              order: item.order,
              isActive: item.isActive,
            },
          }),
        ),
      );
      return;
    }
  }

  create(dto: CreateSkillAssessmentItemDto) {
    return this.prisma.skillAssessmentItem.create({
      data: {
        academicSessionId: dto.academicSessionId,
        groupId: dto.groupId,
        name: dto.name,
        order: dto.order,
        isActive: dto.isActive,
      },
      include: ITEM_INCLUDE,
    });
  }

  update(id: string, dto: UpdateSkillAssessmentItemDto) {
    return this.prisma.skillAssessmentItem.update({ where: { id }, data: dto, include: ITEM_INCLUDE });
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
  findAllForSession(
    @Query("academicSessionId") academicSessionId: string,
    @Query("classLevelCategory") classLevelCategory?: ClassLevelCategory,
  ) {
    return this.service.findAllForSession(academicSessionId, classLevelCategory);
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
