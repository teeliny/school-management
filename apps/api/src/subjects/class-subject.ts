import { BadRequestException, Body, Controller, Delete, Get, Injectable, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ClassLevelCategory, SubjectType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { CreateClassSubjectDto, UpdateClassSubjectDto } from "./dto/class-subject.dto";

// Source of truth for "which subjects exist for which class group, and how
// they apply" (PRD §3.3) — the applicability-rule engine
// (StudentSubjectEnrollmentService) reads this table directly. type/
// departmentId live here (not on Subject) because the same subject can be
// GENERAL for one class group and DEPARTMENT-restricted for another (e.g.
// CRS: GENERAL for JSS, DEPARTMENT for SSS). Deliberately not scoped to an
// AcademicSession — see the model comment in schema.prisma. Duplicate
// prevention is the @@unique constraint, no service-layer re-check needed
// (unlike StaffAssignment's class-teacher rule, which is deliberately
// overridable).
@Injectable()
export class ClassSubjectService {
  constructor(private readonly prisma: PrismaService) {}

  private assertDepartmentConsistency(type: SubjectType, departmentId?: string) {
    if (type === SubjectType.DEPARTMENT && !departmentId) {
      throw new BadRequestException("departmentId is required for a DEPARTMENT class-subject assignment");
    }
    if (type !== SubjectType.DEPARTMENT && departmentId) {
      throw new BadRequestException("departmentId is only valid for a DEPARTMENT class-subject assignment");
    }
  }

  create(dto: CreateClassSubjectDto) {
    this.assertDepartmentConsistency(dto.type, dto.departmentId);
    return this.prisma.classSubject.create({ data: dto });
  }

  findAll(filters: { classLevelCategory?: ClassLevelCategory }) {
    return this.prisma.classSubject.findMany({
      where: { classLevelCategory: filters.classLevelCategory },
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
    if (!dto.type) {
      return this.prisma.classSubject.update({ where: { id }, data: dto });
    }

    this.assertDepartmentConsistency(dto.type, dto.departmentId);
    return this.prisma.classSubject.update({
      where: { id },
      data: {
        ...dto,
        // A client omits departmentId entirely (rather than sending it as
        // null) when switching a subject away from DEPARTMENT — JSON drops
        // `undefined` keys, so Prisma's partial update would otherwise leave
        // the previous department stale on the row. Moving type off
        // DEPARTMENT always clears it explicitly instead.
        departmentId: dto.type === SubjectType.DEPARTMENT ? dto.departmentId : null,
      },
    });
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
  findAll(@Query("classLevelCategory") classLevelCategory?: ClassLevelCategory) {
    return this.service.findAll({ classLevelCategory });
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
