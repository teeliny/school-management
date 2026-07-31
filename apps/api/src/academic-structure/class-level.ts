import { Body, Controller, Delete, Get, Injectable, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { CreateClassLevelDto, UpdateClassLevelDto } from "./dto/class-level.dto";

@Injectable()
export class ClassLevelService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateClassLevelDto) {
    return this.prisma.classLevel.create({ data: dto });
  }

  findAll() {
    return this.prisma.classLevel.findMany({ orderBy: { order: "asc" } });
  }

  findOne(id: string) {
    return this.prisma.classLevel.findUniqueOrThrow({ where: { id } });
  }

  update(id: string, dto: UpdateClassLevelDto) {
    return this.prisma.classLevel.update({ where: { id }, data: dto });
  }

  remove(id: string) {
    return this.prisma.classLevel.delete({ where: { id } });
  }
}

@Controller("class-levels")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class ClassLevelController {
  constructor(private readonly service: ClassLevelService) {}

  @Post()
  @CheckPolicies((ability) => ability.can("manage", "AcademicStructure"))
  create(@Body() dto: CreateClassLevelDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Patch(":id")
  @CheckPolicies((ability) => ability.can("manage", "AcademicStructure"))
  update(@Param("id") id: string, @Body() dto: UpdateClassLevelDto) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @CheckPolicies((ability) => ability.can("manage", "AcademicStructure"))
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
