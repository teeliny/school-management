import { Body, Controller, Delete, Get, Injectable, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { CreateClassSubjectDto, UpdateClassSubjectDto } from "./dto/class-subject.dto";

// Source of truth for "which subjects exist for which class this session"
// (PRD §3.3) — the applicability-rule engine (StudentSubjectEnrollmentService)
// reads this table directly. Duplicate prevention is the @@unique
// constraint, no service-layer re-check needed (unlike StaffAssignment's
// class-teacher rule, which is deliberately overridable).
@Injectable()
export class ClassSubjectService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateClassSubjectDto) {
    return this.prisma.classSubject.create({ data: dto });
  }

  findAll(filters: { classLevelId?: string; academicSessionId?: string }) {
    return this.prisma.classSubject.findMany({
      where: { classLevelId: filters.classLevelId, academicSessionId: filters.academicSessionId },
      include: { subject: { include: { childSubjects: true } }, termStatuses: { include: { term: true } } },
      orderBy: { createdAt: "asc" },
    });
  }

  findOne(id: string) {
    return this.prisma.classSubject.findUniqueOrThrow({
      where: { id },
      include: { subject: { include: { childSubjects: true } }, termStatuses: { include: { term: true } } },
    });
  }

  update(id: string, dto: UpdateClassSubjectDto) {
    return this.prisma.classSubject.update({ where: { id }, data: dto });
  }

  remove(id: string) {
    return this.prisma.classSubject.delete({ where: { id } });
  }
}

@Controller("class-subjects")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class ClassSubjectController {
  constructor(private readonly service: ClassSubjectService) {}

  @Post()
  @CheckPolicies((ability) => ability.can("manage", "ClassSubject"))
  create(@Body() dto: CreateClassSubjectDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll(@Query("classLevelId") classLevelId?: string, @Query("academicSessionId") academicSessionId?: string) {
    return this.service.findAll({ classLevelId, academicSessionId });
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Patch(":id")
  @CheckPolicies((ability) => ability.can("manage", "ClassSubject"))
  update(@Param("id") id: string, @Body() dto: UpdateClassSubjectDto) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @CheckPolicies((ability) => ability.can("manage", "ClassSubject"))
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
