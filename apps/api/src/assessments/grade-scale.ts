import { Body, Controller, Delete, Get, Injectable, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { CreateGradeScaleDto, UpdateGradeScaleDto } from "./dto/grade-scale.dto";

@Injectable()
export class GradeScaleService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateGradeScaleDto) {
    return this.prisma.gradeScale.create({ data: dto });
  }

  findAll() {
    return this.prisma.gradeScale.findMany({ orderBy: { minScore: "desc" } });
  }

  update(id: string, dto: UpdateGradeScaleDto) {
    return this.prisma.gradeScale.update({ where: { id }, data: dto });
  }

  remove(id: string) {
    return this.prisma.gradeScale.delete({ where: { id } });
  }
}

@Controller("grade-scales")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class GradeScaleController {
  constructor(private readonly service: GradeScaleService) {}

  @Post()
  @CheckPolicies((ability) => ability.can("manage", "AssessmentComponent"))
  create(@Body() dto: CreateGradeScaleDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Patch(":id")
  @CheckPolicies((ability) => ability.can("manage", "AssessmentComponent"))
  update(@Param("id") id: string, @Body() dto: UpdateGradeScaleDto) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @CheckPolicies((ability) => ability.can("manage", "AssessmentComponent"))
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
