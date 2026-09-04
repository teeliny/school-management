import { Body, Controller, Delete, Get, Injectable, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { CreateSkillGroupDto, UpdateSkillGroupDto } from "./dto/skill-group.dto";

const GROUP_INCLUDE = { classLevelCategories: true } satisfies Prisma.SkillGroupInclude;

// Replaces the old fixed PSYCHOMOTOR/AFFECTIVE_COGNITIVE SkillCategory
// enum — an Admin-named, admin-created bucket for SkillAssessmentItems,
// same "named group" shape as ClassSubjectConcurrencyGroup (elective
// blocks): create the group here first, then assign items to it (see
// SkillAssessmentItemService). Scoped to an AcademicSession, same as items.
@Injectable()
export class SkillGroupService {
  constructor(private readonly prisma: PrismaService) {}

  findAllForSession(academicSessionId: string) {
    return this.prisma.skillGroup.findMany({
      where: { academicSessionId },
      include: GROUP_INCLUDE,
      orderBy: { order: "asc" },
    });
  }

  create(dto: CreateSkillGroupDto) {
    return this.prisma.skillGroup.create({
      data: {
        academicSessionId: dto.academicSessionId,
        name: dto.name,
        order: dto.order,
        valueType: dto.valueType,
        isActive: dto.isActive,
        classLevelCategories: dto.classLevelCategories
          ? { create: dto.classLevelCategories.map((c) => ({ classLevelCategory: c })) }
          : undefined,
      },
      include: GROUP_INCLUDE,
    });
  }

  /**
   * classLevelCategories, when present in the DTO (even as an empty array —
   * that's how a caller clears a restriction back to "applies everywhere"),
   * is synced by delete-then-recreate — same shape as
   * SkillAssessmentItemService.update used before this restriction moved
   * from the item to the group.
   */
  async update(id: string, dto: UpdateSkillGroupDto) {
    const { classLevelCategories, ...scalarFields } = dto;

    if (classLevelCategories === undefined) {
      return this.prisma.skillGroup.update({ where: { id }, data: scalarFields, include: GROUP_INCLUDE });
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.skillGroup.update({ where: { id }, data: scalarFields });
      await tx.skillGroupClassLevelCategory.deleteMany({ where: { skillGroupId: id } });
      if (classLevelCategories.length > 0) {
        await tx.skillGroupClassLevelCategory.createMany({
          data: classLevelCategories.map((c) => ({ skillGroupId: id, classLevelCategory: c })),
        });
      }
      return tx.skillGroup.findUniqueOrThrow({ where: { id }, include: GROUP_INCLUDE });
    });
  }

  // Cascades to every item in the group, and every rating against those
  // items (schema-level onDelete: Cascade) — same "no extra guard, deleting
  // was always destructive this way" shape SkillAssessmentItemController's
  // own remove() already had before groups existed.
  remove(id: string) {
    return this.prisma.skillGroup.delete({ where: { id } });
  }
}

@Controller("skill-groups")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class SkillGroupController {
  constructor(private readonly service: SkillGroupService) {}

  @Get()
  findAllForSession(@Query("academicSessionId") academicSessionId: string) {
    return this.service.findAllForSession(academicSessionId);
  }

  @Post()
  @CheckPolicies((ability) => ability.can("manage", "SkillAssessmentItem"))
  create(@Body() dto: CreateSkillGroupDto) {
    return this.service.create(dto);
  }

  @Patch(":id")
  @CheckPolicies((ability) => ability.can("manage", "SkillAssessmentItem"))
  update(@Param("id") id: string, @Body() dto: UpdateSkillGroupDto) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @CheckPolicies((ability) => ability.can("manage", "SkillAssessmentItem"))
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
