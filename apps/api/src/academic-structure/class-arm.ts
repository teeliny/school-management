import { Body, Controller, Delete, Get, Injectable, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { resolvePrincipalHeadteacherCategories } from "../common/class-level-category-scope";
import { Audited } from "../audit/audited.decorator";
import { CreateClassArmDto, UpdateClassArmDto } from "./dto/class-arm.dto";

const CLASS_ARM_DETAIL_INCLUDE = { classLevel: { select: { name: true, category: true } } } as const;

// "{ClassLevel.name} {ClassArm.name}" (e.g. "SSS 2 Topaz") — the one place
// this format lives; every list/detail/dropdown consumer renders
// `displayName` instead of re-deriving it client-side. `name` itself stays
// just the raw arm name (e.g. "Topaz"), which is what an edit form should
// pre-fill from — the class + session are already picked separately when
// creating an arm, so its own name never needs to repeat them.
export function withDisplayName<T extends { name: string; classLevel: { name: string } }>(
  arm: T,
): T & { displayName: string } {
  return { ...arm, displayName: `${arm.classLevel.name} ${arm.name}` };
}

@Injectable()
export class ClassArmService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateClassArmDto) {
    return this.prisma.classArm.create({ data: dto });
  }

  /**
   * `user`, when supplied (the controller always passes it), narrows the
   * list for a Principal/Headteacher to their own section (JSS/SSS vs.
   * Creche/Reception/Nursery/Primary) — this is the shared class-arm picker
   * behind Report Cards/Attendance/Skills & Comments/Planner/Broadsheet/
   * Gradebook, so fixing it here fixes every one of those pages at once,
   * rather than each frontend page filtering the same unscoped list
   * separately. Safe to apply unconditionally: Super-Admin/Admin/Registrar
   * (including class-arm-manager.tsx's Admin-only CRUD page) get `null`
   * from resolvePrincipalHeadteacherCategories and stay fully unscoped, and
   * a plain STAFF member (no Principal/Headteacher title) also gets `null`
   * — this endpoint has never restricted them and still doesn't.
   */
  async findAll(classLevelId?: string, academicSessionId?: string, user?: RequestUser) {
    const categories = user ? resolvePrincipalHeadteacherCategories(user) : null;
    const arms = await this.prisma.classArm.findMany({
      where: {
        classLevelId: classLevelId || undefined,
        academicSessionId: academicSessionId || undefined,
        ...(categories ? { classLevel: { category: { in: categories } } } : {}),
      },
      include: CLASS_ARM_DETAIL_INCLUDE,
      orderBy: { name: "asc" },
    });
    return arms.map(withDisplayName);
  }

  async findOne(id: string) {
    const arm = await this.prisma.classArm.findUniqueOrThrow({ where: { id }, include: CLASS_ARM_DETAIL_INCLUDE });
    return withDisplayName(arm);
  }

  update(id: string, dto: UpdateClassArmDto) {
    return this.prisma.classArm.update({ where: { id }, data: dto });
  }

  remove(id: string) {
    return this.prisma.classArm.delete({ where: { id } });
  }
}

@Controller("class-arms")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class ClassArmController {
  constructor(private readonly service: ClassArmService) {}

  @Post()
  @CheckPolicies((ability) => ability.can("manage", "AcademicStructure"))
  @Audited("ClassArm")
  create(@Body() dto: CreateClassArmDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: RequestUser,
    @Query("classLevelId") classLevelId?: string,
    @Query("academicSessionId") academicSessionId?: string,
  ) {
    return this.service.findAll(classLevelId, academicSessionId, user);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Patch(":id")
  @CheckPolicies((ability) => ability.can("manage", "AcademicStructure"))
  @Audited("ClassArm", "classArm")
  update(@Param("id") id: string, @Body() dto: UpdateClassArmDto) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @CheckPolicies((ability) => ability.can("manage", "AcademicStructure"))
  @Audited("ClassArm", "classArm")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
