import { Body, Controller, Delete, Get, Injectable, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
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

  async findAll(classLevelId?: string, academicSessionId?: string) {
    const arms = await this.prisma.classArm.findMany({
      where: { classLevelId: classLevelId || undefined, academicSessionId: academicSessionId || undefined },
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
  create(@Body() dto: CreateClassArmDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll(@Query("classLevelId") classLevelId?: string, @Query("academicSessionId") academicSessionId?: string) {
    return this.service.findAll(classLevelId, academicSessionId);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Patch(":id")
  @CheckPolicies((ability) => ability.can("manage", "AcademicStructure"))
  update(@Param("id") id: string, @Body() dto: UpdateClassArmDto) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @CheckPolicies((ability) => ability.can("manage", "AcademicStructure"))
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
