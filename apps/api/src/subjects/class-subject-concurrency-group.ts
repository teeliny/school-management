import { Body, Controller, Get, Injectable, Post, Query, UseGuards } from "@nestjs/common";
import { ClassLevelCategory } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { CreateClassSubjectConcurrencyGroupDto } from "./dto/class-subject-concurrency-group.dto";

// "Options column" groups (PRD §3.3 follow-up, see schema.prisma's
// ClassSubjectConcurrencyGroup comment) — e.g. SSS's Physics/Financial
// Accounting/Literature in English, scheduled in parallel instead of each
// reserving separate weekly capacity. Deliberately no update/delete here yet
// (mirrors Department's own read+create-only CRUD) — membership is managed
// from the ClassSubject side (ClassSubjectService.update's concurrencyGroupId),
// not by editing the group itself.
@Injectable()
export class ClassSubjectConcurrencyGroupService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateClassSubjectConcurrencyGroupDto) {
    return this.prisma.classSubjectConcurrencyGroup.create({ data: dto });
  }

  findAll(filters: { classLevelCategory?: ClassLevelCategory }) {
    return this.prisma.classSubjectConcurrencyGroup.findMany({
      where: { classLevelCategory: filters.classLevelCategory },
      orderBy: { createdAt: "asc" },
    });
  }
}

@Controller("class-subject-concurrency-groups")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class ClassSubjectConcurrencyGroupController {
  constructor(private readonly service: ClassSubjectConcurrencyGroupService) {}

  @Post()
  @CheckPolicies((ability) => ability.can("manage", "ClassSubject"))
  create(@Body() dto: CreateClassSubjectConcurrencyGroupDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll(@Query("classLevelCategory") classLevelCategory?: ClassLevelCategory) {
    return this.service.findAll({ classLevelCategory });
  }
}
