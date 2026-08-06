import { Body, Controller, Delete, Get, Injectable, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { CreateClassArmDto, UpdateClassArmDto } from "./dto/class-arm.dto";

@Injectable()
export class ClassArmService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateClassArmDto) {
    return this.prisma.classArm.create({ data: dto });
  }

  findAll(classLevelId?: string, academicSessionId?: string) {
    return this.prisma.classArm.findMany({
      where: { classLevelId: classLevelId || undefined, academicSessionId: academicSessionId || undefined },
      include: { classLevel: { select: { category: true } } },
      orderBy: { name: "asc" },
    });
  }

  findOne(id: string) {
    return this.prisma.classArm.findUniqueOrThrow({ where: { id } });
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
