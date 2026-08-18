import { Body, Controller, Delete, Get, Injectable, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { CreateSubjectGroupWeightDto, UpdateSubjectGroupWeightDto } from "./dto/subject-group-weight.dto";

// Standalone CRUD for post-hoc weight adjustment — the initial set of
// weights is normally created via SubjectService.createGroup (PRD §3.3),
// this is for editing them afterward without recreating the whole group.
@Injectable()
export class SubjectGroupWeightService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateSubjectGroupWeightDto) {
    return this.prisma.subjectGroupWeight.create({ data: dto });
  }

  findAll(groupSubjectId?: string) {
    return this.prisma.subjectGroupWeight.findMany({
      where: groupSubjectId ? { groupSubjectId } : undefined,
      include: { childSubject: true },
    });
  }

  update(id: string, dto: UpdateSubjectGroupWeightDto) {
    return this.prisma.subjectGroupWeight.update({ where: { id }, data: dto });
  }

  remove(id: string) {
    return this.prisma.subjectGroupWeight.delete({ where: { id } });
  }
}

@Controller("subject-group-weights")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class SubjectGroupWeightController {
  constructor(private readonly service: SubjectGroupWeightService) {}

  @Post()
  @CheckPolicies((ability) => ability.can("manage", "SubjectGroupWeight"))
  create(@Body() dto: CreateSubjectGroupWeightDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll(@Query("groupSubjectId") groupSubjectId?: string) {
    return this.service.findAll(groupSubjectId);
  }

  @Patch(":id")
  @CheckPolicies((ability) => ability.can("manage", "SubjectGroupWeight"))
  update(@Param("id") id: string, @Body() dto: UpdateSubjectGroupWeightDto) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @CheckPolicies((ability) => ability.can("manage", "SubjectGroupWeight"))
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
