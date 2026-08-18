import { BadRequestException, Body, Controller, Delete, Get, Injectable, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ClassLevelCategory, SubjectType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { CreateClassSubjectDto, UpdateClassSubjectDto } from "./dto/class-subject.dto";
import { SetChildPeriodsDto } from "./dto/class-subject-child-periods.dto";
import { StudentSubjectEnrollmentService } from "./student-subject-enrollment";

// Mirrors the schema.prisma `ClassSubject.periodsPerWeek` column default —
// needed here because a create() that omits periodsPerWeek still lands on 3
// at the DB layer, and the concurrency-group check has to validate against
// that same effective value, not "undefined".
const DEFAULT_PERIODS_PER_WEEK = 3;

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly studentSubjectEnrollments: StudentSubjectEnrollmentService,
  ) {}

  private assertDepartmentConsistency(type: SubjectType, departmentId?: string) {
    if (type === SubjectType.DEPARTMENT && !departmentId) {
      throw new BadRequestException("departmentId is required for a DEPARTMENT class-subject assignment");
    }
    if (type !== SubjectType.DEPARTMENT && departmentId) {
      throw new BadRequestException("departmentId is only valid for a DEPARTMENT class-subject assignment");
    }
  }

  /**
   * PRD §3.3: a group subject (isGroup=true) is never itself scheduled —
   * only its childSubjects are — so bundling its ClassSubject row into an
   * elective block would incorrectly force every one of its (usually
   * unrelated, usually compulsory) children onto one shared slot set
   * instead of each getting independent periods. ClassSubjectChildPeriods
   * lets children vary their periodsPerWeek individually, but elective-block
   * membership stays a non-group-only concept for now.
   */
  private assertConcurrencyGroupNotOnGroupSubject(isGroupSubject: boolean, concurrencyGroupId: string | null | undefined) {
    if (isGroupSubject && concurrencyGroupId) {
      throw new BadRequestException("A group subject can't join an elective block — only its individual children are ever scheduled");
    }
  }

  /**
   * The class-timetable/exam-timetable solvers (BUILD_PLAN.md §9 Step 2/3)
   * pin every ClassSubjectConcurrencyGroup member to the exact same weekly
   * slots (class timetable) or exam day — so a group can only ever contain
   * rows for its own classLevelCategory, all at the same periodsPerWeek.
   * Checked against the row's effective (post-this-write) values, not the
   * DTO alone, so a periodsPerWeek-only edit on an already-grouped row is
   * caught too. excludeId is the row being written, so it isn't compared
   * against itself.
   */
  private async assertConcurrencyGroupConsistency(
    classLevelCategory: ClassLevelCategory,
    periodsPerWeek: number,
    concurrencyGroupId: string | null | undefined,
    excludeId?: string,
  ) {
    if (!concurrencyGroupId) return;

    const group = await this.prisma.classSubjectConcurrencyGroup.findUniqueOrThrow({
      where: { id: concurrencyGroupId },
    });
    if (group.classLevelCategory !== classLevelCategory) {
      throw new BadRequestException(
        `Elective block "${group.name}" is for ${group.classLevelCategory}, not ${classLevelCategory}`,
      );
    }

    const siblings = await this.prisma.classSubject.findMany({
      where: { concurrencyGroupId, id: excludeId ? { not: excludeId } : undefined },
    });
    const mismatch = siblings.find((s) => s.periodsPerWeek !== periodsPerWeek);
    if (mismatch) {
      throw new BadRequestException(
        `Every subject in elective block "${group.name}" must share the same periods/week (currently ${mismatch.periodsPerWeek}) — update the whole block instead of one member`,
      );
    }
  }

  async create(dto: CreateClassSubjectDto) {
    this.assertDepartmentConsistency(dto.type, dto.departmentId);
    const subject = await this.prisma.subject.findUniqueOrThrow({ where: { id: dto.subjectId }, select: { isGroup: true } });
    this.assertConcurrencyGroupNotOnGroupSubject(subject.isGroup, dto.concurrencyGroupId);
    await this.assertConcurrencyGroupConsistency(
      dto.classLevelCategory,
      dto.periodsPerWeek ?? DEFAULT_PERIODS_PER_WEEK,
      dto.concurrencyGroupId,
    );
    const classSubject = await this.prisma.classSubject.create({ data: dto });
    // Fire-and-forget, same rationale as StudentSubjectEnrollmentService.enroll's
    // recompute queue call — a newly-created COMPULSORY row can immediately
    // apply to students already sitting in that class category.
    await this.studentSubjectEnrollments.syncEnrollmentsForClassSubject(classSubject.id);
    return classSubject;
  }

  findAll(filters: { classLevelCategory?: ClassLevelCategory }) {
    return this.prisma.classSubject.findMany({
      where: { classLevelCategory: filters.classLevelCategory },
      include: {
        subject: { include: { childSubjects: true } },
        termStatuses: { include: { term: true } },
        childPeriodOverrides: true,
      },
      orderBy: { createdAt: "asc" },
    });
  }

  findOne(id: string) {
    return this.prisma.classSubject.findUniqueOrThrow({
      where: { id },
      include: {
        subject: { include: { childSubjects: true } },
        termStatuses: { include: { term: true } },
        childPeriodOverrides: true,
      },
    });
  }

  async update(id: string, dto: UpdateClassSubjectDto) {
    // Fetched unconditionally now (not just on a type change) — the
    // concurrency-group check below needs the row's *effective* post-write
    // classLevelCategory/periodsPerWeek even when only one of them is part
    // of this particular PATCH.
    const existing = await this.prisma.classSubject.findUniqueOrThrow({
      where: { id },
      include: { subject: { select: { isGroup: true } } },
    });

    const effectiveConcurrencyGroupId = dto.concurrencyGroupId !== undefined ? dto.concurrencyGroupId : existing.concurrencyGroupId;
    this.assertConcurrencyGroupNotOnGroupSubject(existing.subject.isGroup, effectiveConcurrencyGroupId);
    await this.assertConcurrencyGroupConsistency(
      dto.classLevelCategory ?? existing.classLevelCategory,
      dto.periodsPerWeek ?? existing.periodsPerWeek,
      effectiveConcurrencyGroupId,
      id,
    );

    if (!dto.type) {
      const classSubject = await this.prisma.classSubject.update({ where: { id }, data: dto });
      await this.studentSubjectEnrollments.syncEnrollmentsForClassSubject(classSubject.id);
      return classSubject;
    }

    this.assertDepartmentConsistency(dto.type, dto.departmentId);
    const classSubject = await this.prisma.classSubject.update({
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
    // Covers both "flipped to COMPULSORY" (backfills students already in
    // that class category, same as create()) and "flipped away from
    // COMPULSORY" (syncEnrollmentsForClassSubject no-ops in that case —
    // dropping existing enrollments on a type change isn't this hook's job).
    await this.studentSubjectEnrollments.syncEnrollmentsForClassSubject(classSubject.id);
    return classSubject;
  }

  remove(id: string) {
    return this.prisma.classSubject.delete({ where: { id } });
  }

  /**
   * Upserts a per-child periodsPerWeek override (ClassSubjectChildPeriods) —
   * childSubjectId must actually be one of this row's subject.childSubjects,
   * same "named explicitly, not just any Subject id" validation
   * ClassSubjectTermStatus's per-child disable already relies on.
   */
  async setChildPeriods(classSubjectId: string, childSubjectId: string, dto: SetChildPeriodsDto) {
    const classSubject = await this.prisma.classSubject.findUniqueOrThrow({
      where: { id: classSubjectId },
      include: { subject: { include: { childSubjects: true } } },
    });
    if (!classSubject.subject.childSubjects.some((c) => c.id === childSubjectId)) {
      throw new BadRequestException(`${childSubjectId} is not a child subject of "${classSubject.subject.name}"`);
    }

    return this.prisma.classSubjectChildPeriods.upsert({
      where: { classSubjectId_childSubjectId: { classSubjectId, childSubjectId } },
      create: { classSubjectId, childSubjectId, periodsPerWeek: dto.periodsPerWeek },
      update: { periodsPerWeek: dto.periodsPerWeek },
    });
  }

  /** Reverts a child back to inheriting classSubject.periodsPerWeek — a no-op if no override exists yet. */
  async clearChildPeriods(classSubjectId: string, childSubjectId: string) {
    await this.prisma.classSubjectChildPeriods.deleteMany({ where: { classSubjectId, childSubjectId } });
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

  @Patch(":id/children/:childSubjectId/periods")
  @CheckPolicies((ability) => ability.can("manage", "ClassSubject"))
  setChildPeriods(@Param("id") id: string, @Param("childSubjectId") childSubjectId: string, @Body() dto: SetChildPeriodsDto) {
    return this.service.setChildPeriods(id, childSubjectId, dto);
  }

  @Delete(":id/children/:childSubjectId/periods")
  @CheckPolicies((ability) => ability.can("manage", "ClassSubject"))
  clearChildPeriods(@Param("id") id: string, @Param("childSubjectId") childSubjectId: string) {
    return this.service.clearChildPeriods(id, childSubjectId);
  }
}
