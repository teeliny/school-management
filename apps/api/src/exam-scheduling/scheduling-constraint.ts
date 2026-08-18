import { Body, Controller, Delete, Get, Injectable, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ScheduleScope } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { CreateSchedulingConstraintDto, UpdateSchedulingConstraintDto } from "./dto/scheduling-constraint.dto";

/**
 * PRD §3.8: lets Admin tune the AI generator's rules without a code change.
 * Seeded with defaults at `pnpm setup:school` (setup-school.ts); this is the
 * CRUD surface for editing them afterward — same Admin-only-config-resource
 * shape as AssessmentComponent/GradeScale.
 */
@Injectable()
export class SchedulingConstraintService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateSchedulingConstraintDto) {
    return this.prisma.schedulingConstraint.create({ data: dto });
  }

  update(id: string, dto: UpdateSchedulingConstraintDto) {
    return this.prisma.schedulingConstraint.update({ where: { id }, data: dto });
  }

  findAll(filters: { scope?: ScheduleScope }) {
    return this.prisma.schedulingConstraint.findMany({
      where: filters,
      orderBy: [{ scope: "asc" }, { key: "asc" }],
    });
  }

  findOne(id: string) {
    return this.prisma.schedulingConstraint.findUniqueOrThrow({ where: { id } });
  }

  remove(id: string) {
    return this.prisma.schedulingConstraint.delete({ where: { id } });
  }
}

@Controller("scheduling-constraints")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class SchedulingConstraintController {
  constructor(private readonly service: SchedulingConstraintService) {}

  @Post()
  @CheckPolicies((ability) => ability.can("manage", "SchedulingConstraint"))
  create(@Body() dto: CreateSchedulingConstraintDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll(@Query("scope") scope?: ScheduleScope) {
    return this.service.findAll({ scope });
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Patch(":id")
  @CheckPolicies((ability) => ability.can("manage", "SchedulingConstraint"))
  update(@Param("id") id: string, @Body() dto: UpdateSchedulingConstraintDto) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @CheckPolicies((ability) => ability.can("manage", "SchedulingConstraint"))
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
