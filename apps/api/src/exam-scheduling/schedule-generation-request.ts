import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { randomBytes } from "node:crypto";
import {
  AssessmentComponentType,
  ClassLevelCategory,
  ClassLevelCategoryGroup,
  ScheduleGenerationStatus,
  ScheduleScope,
  TimetableApprovalStatus,
} from "@prisma/client";
import {
  CLASS_LEVEL_CATEGORIES,
  categoryToGroup,
  DAYS_OF_WEEK,
  parseSpecialPeriods,
  QUEUE_NAMES,
  type SchedulingSolveDispatchJob,
} from "@school/types";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { AbilityFactory } from "../casl/ability.factory";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { Audited } from "../audit/audited.decorator";
import { CreateScheduleGenerationRequestDto } from "./dto/schedule-generation-request.dto";
import { RejectScheduleRowDto } from "./dto/reject-schedule-row.dto";
import { TimetableSlotService } from "../timetable/timetable-slot";
import { ExamScheduleService } from "./exam-schedule";
import { InvigilationAssignmentService } from "./invigilation-assignment";

@Injectable()
export class ScheduleGenerationRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly abilityFactory: AbilityFactory,
    @InjectQueue(QUEUE_NAMES.SCHEDULING_SOLVE_DISPATCH)
    private readonly dispatchQueue: Queue<SchedulingSolveDispatchJob>,
    private readonly timetableSlots: TimetableSlotService,
    private readonly examSchedules: ExamScheduleService,
    private readonly invigilationAssignments: InvigilationAssignmentService,
  ) {}

  /**
   * PRD §5 footnote 5: triggering generation is gated by
   * StaffAssignment.assignmentType, not Role alone — Super-Admin/Registrar
   * are unscoped, an Admin holding PRINCIPAL may only target JSS/SSS,
   * HEADTEACHER only CRECHE/NURSERY/PRIMARY, and an Admin holding neither
   * cannot trigger at all. The target's class-level-category group is
   * resolved from whichever scoping field the request supplies; a request
   * with no scoping field at all (a whole-school run) is allowed through for
   * Super-Admin/Registrar only — a Principal/Headteacher run must always
   * name its own group (via classArmId/assessmentComponentId/
   * classLevelCategoryGroup) so this check has something to compare against.
   */
  private async resolveTargetGroup(dto: CreateScheduleGenerationRequestDto): Promise<ClassLevelCategoryGroup | null> {
    if (dto.classLevelCategoryGroup) return dto.classLevelCategoryGroup;

    if (dto.classArmId) {
      const classArm = await this.prisma.classArm.findUniqueOrThrow({
        where: { id: dto.classArmId },
        include: { classLevel: true },
      });
      return categoryToGroup(classArm.classLevel.category);
    }

    if (dto.assessmentComponentId) {
      const component = await this.prisma.assessmentComponent.findUniqueOrThrow({
        where: { id: dto.assessmentComponentId },
      });
      return categoryToGroup(component.classLevelCategory);
    }

    return null;
  }

  private async assertCanTrigger(user: RequestUser, dto: CreateScheduleGenerationRequestDto) {
    const ability = this.abilityFactory.createForUser(user);
    if (!ability.can("manage", "ScheduleGenerationRequest")) {
      throw new ForbiddenException(
        "Only Super-Admin, Registrar, or a staff member holding an active Principal/Headteacher assignment can trigger schedule generation",
      );
    }

    // Super-Admin/Registrar are unscoped — nothing further to check.
    if (user.roles.includes("SUPER_ADMIN") || user.assignmentTypes.includes("REGISTRAR")) return;

    const targetGroup = await this.resolveTargetGroup(dto);
    const isPrincipal = user.assignmentTypes.includes("PRINCIPAL");
    const isHeadteacher = user.assignmentTypes.includes("HEADTEACHER");
    const allowedGroup = isPrincipal
      ? ClassLevelCategoryGroup.JSS_SSS
      : isHeadteacher
        ? ClassLevelCategoryGroup.CRECHE_NURSERY_PRIMARY
        : null;

    if (!allowedGroup) {
      throw new ForbiddenException("An Admin without an active Principal/Headteacher assignment cannot trigger schedule generation");
    }
    if (!targetGroup) {
      throw new BadRequestException(
        "A Principal/Headteacher-triggered request must specify classArmId, assessmentComponentId, or classLevelCategoryGroup so it can be scoped",
      );
    }
    if (targetGroup !== allowedGroup) {
      throw new ForbiddenException(`This assignment is not scoped to ${targetGroup} class arms`);
    }
  }

  /**
   * BUILD_PLAN.md §9 Step 3: assessmentComponentId must resolve to an EXAM
   * or MID_TERM component (CA has no exam to schedule), and the
   * exam-writing date range — which isn't stored anywhere else (PRD's
   * inputOpensAt/inputClosesAt are score-entry windows, not exam-sitting
   * dates) — comes from parameters.examStartDate/examEndDate, validated to
   * fall within that component's own Term.
   */
  private async assertValidExamTimetableRequest(dto: CreateScheduleGenerationRequestDto) {
    if (!dto.assessmentComponentId) {
      throw new BadRequestException("assessmentComponentId is required for EXAM_TIMETABLE scope");
    }
    const component = await this.prisma.assessmentComponent.findUniqueOrThrow({
      where: { id: dto.assessmentComponentId },
      include: { term: true },
    });
    if (component.type !== AssessmentComponentType.EXAM && component.type !== AssessmentComponentType.MID_TERM) {
      throw new BadRequestException("assessmentComponentId must resolve to an EXAM or MID_TERM component");
    }

    const parameters = (dto.parameters ?? {}) as Record<string, unknown>;
    const examStartDate = typeof parameters.examStartDate === "string" ? new Date(parameters.examStartDate) : null;
    const examEndDate = typeof parameters.examEndDate === "string" ? new Date(parameters.examEndDate) : null;
    if (!examStartDate || !examEndDate || Number.isNaN(examStartDate.getTime()) || Number.isNaN(examEndDate.getTime())) {
      throw new BadRequestException("parameters.examStartDate and parameters.examEndDate (YYYY-MM-DD) are required for EXAM_TIMETABLE scope");
    }
    if (examStartDate > examEndDate) {
      throw new BadRequestException("parameters.examStartDate must be on or before examEndDate");
    }
    if (examStartDate < component.term.startDate || examEndDate > component.term.endDate) {
      throw new BadRequestException("The exam period must fall within the assessment component's term");
    }
  }

  /**
   * BUILD_PLAN.md §9 Step 5: resolves the target ClassLevelCategoryGroup(s)
   * for a WEEKLY_DUTY request — dto.classLevelCategoryGroup if set (always
   * true for a Principal/Headteacher trigger, enforced by assertCanTrigger),
   * otherwise both groups (a Super-Admin/Registrar combined run, FR6.11).
   */
  private resolveWeeklyDutyTargetGroups(dto: CreateScheduleGenerationRequestDto): ClassLevelCategoryGroup[] {
    return dto.classLevelCategoryGroup
      ? [dto.classLevelCategoryGroup]
      : [ClassLevelCategoryGroup.JSS_SSS, ClassLevelCategoryGroup.CRECHE_NURSERY_PRIMARY];
  }

  /**
   * BUILD_PLAN.md §9 Step 5: termId's Term must exist (required earlier in
   * create()); every target group is checked for a pre-existing, non-
   * REJECTED DutyAssignment row already covering one of that term's weeks —
   * DutyAssignment has no per-row conflict check the way TimetableSlot/
   * ExamSchedule/InvigilationAssignment do (no overlap concept, just whole
   * weeks), so a second run against an already-rostered term/group is
   * rejected outright here instead, rather than silently double-staffing
   * every week. parameters.teachersPerWeek, if supplied, must be a positive
   * integer (falls back to the seeded TEACHERS_PER_WEEK default otherwise).
   */
  private async assertValidWeeklyDutyRequest(dto: CreateScheduleGenerationRequestDto) {
    if (!dto.termId) {
      throw new BadRequestException("termId is required for WEEKLY_DUTY scope");
    }
    const term = await this.prisma.term.findUniqueOrThrow({ where: { id: dto.termId } });

    const targetGroups = this.resolveWeeklyDutyTargetGroups(dto);
    const existing = await this.prisma.dutyAssignment.findFirst({
      where: {
        classLevelCategoryGroup: { in: targetGroups },
        weekStartDate: { gte: term.startDate, lte: term.endDate },
        approvalStatus: { not: TimetableApprovalStatus.REJECTED },
      },
    });
    if (existing) {
      throw new BadRequestException(
        `A duty roster already exists for this term and ${existing.classLevelCategoryGroup} group — reject the existing rows first if you want to regenerate`,
      );
    }

    const parameters = (dto.parameters ?? {}) as Record<string, unknown>;
    if (
      parameters.teachersPerWeek !== undefined &&
      (typeof parameters.teachersPerWeek !== "number" ||
        !Number.isInteger(parameters.teachersPerWeek) ||
        parameters.teachersPerWeek < 1)
    ) {
      throw new BadRequestException("parameters.teachersPerWeek must be a positive integer");
    }
  }

  /**
   * BUILD_PLAN.md §9 Step 4: assessmentComponentId must resolve to an EXAM
   * or MID_TERM component (same reuse of EXAM_TIMETABLE's FK, confirmed by
   * PRD §3.8), and — per the approval-order decision made for this step —
   * every ExamSchedule row in scope (narrowed by classArmId if set) must
   * already be Admin-approved, so InvigilationAssignment rows are never
   * generated against a still-editable draft.
   */
  private async assertValidInvigilationRequest(dto: CreateScheduleGenerationRequestDto) {
    if (!dto.assessmentComponentId) {
      throw new BadRequestException("assessmentComponentId is required for INVIGILATION scope");
    }
    const component = await this.prisma.assessmentComponent.findUniqueOrThrow({
      where: { id: dto.assessmentComponentId },
    });
    if (component.type !== AssessmentComponentType.EXAM && component.type !== AssessmentComponentType.MID_TERM) {
      throw new BadRequestException("assessmentComponentId must resolve to an EXAM or MID_TERM component");
    }

    const examSchedules = await this.prisma.examSchedule.findMany({
      where: { assessmentComponentId: dto.assessmentComponentId, classArmId: dto.classArmId },
      select: { approvalStatus: true },
    });
    if (examSchedules.length === 0) {
      throw new BadRequestException("No exam schedules exist yet for this assessment component — generate the exam timetable first");
    }
    if (examSchedules.some((es) => es.approvalStatus !== TimetableApprovalStatus.APPROVED)) {
      throw new BadRequestException("All exam schedules for this assessment component must be approved before generating invigilation");
    }
  }

  /**
   * A subject required for a classLevelCategory, flattened the same way
   * apps/worker's SchedulingSolveDispatchProcessor.resolveRequiredSubjects
   * does (isGroup subjects expand to their childSubjects, each inheriting
   * the parent ClassSubject row's periodsPerWeek/concurrencyGroupId) —
   * deliberately re-derived here rather than shared with the worker: this
   * needs to run synchronously in the API, before any BullMQ involvement,
   * matching the worker's own "never trust upstream, re-derive" precedent
   * in reverse.
   */
  private async resolveFlattenedRequiredSubjects(
    category: ClassLevelCategory,
  ): Promise<{ id: string; periodsPerWeek: number; requiresCalculation: boolean; concurrencyGroupId: string | null }[]> {
    const classSubjects = await this.prisma.classSubject.findMany({
      where: { classLevelCategory: category },
      include: { subject: { include: { childSubjects: true } }, childPeriodOverrides: true },
    });

    return classSubjects.flatMap((cs) =>
      cs.subject.isGroup
        ? cs.subject.childSubjects.map((child) => ({
            id: child.id,
            // Same per-child override precedence as apps/worker's own
            // resolveRequiredSubjects (ClassSubjectChildPeriods) — re-derived
            // here rather than shared, same reasoning as the rest of this method.
            periodsPerWeek: cs.childPeriodOverrides.find((o) => o.childSubjectId === child.id)?.periodsPerWeek ?? cs.periodsPerWeek,
            requiresCalculation: child.requiresCalculation,
            concurrencyGroupId: cs.concurrencyGroupId,
          }))
        : [
            {
              id: cs.subject.id,
              periodsPerWeek: cs.periodsPerWeek,
              requiresCalculation: cs.subject.requiresCalculation,
              concurrencyGroupId: cs.concurrencyGroupId,
            },
          ],
    );
  }

  /** Same "unscoped for Super-Admin/Registrar, Principal→JSS/SSS, Headteacher→Creche/Nursery/Primary" mapping assertCanTrigger already checked, read directly off the JWT-derived RequestUser rather than a fresh DB round-trip (the worker's own resolveAllowedCategories re-derives it from the DB since it only has a userId — the API already has the roles/assignmentTypes in hand here). */
  private resolveAllowedCategoriesFromUser(user: RequestUser): ClassLevelCategory[] {
    if (user.roles.includes("SUPER_ADMIN") || user.assignmentTypes.includes("REGISTRAR")) {
      return [...CLASS_LEVEL_CATEGORIES];
    }
    if (user.assignmentTypes.includes("PRINCIPAL")) return ["JSS", "SSS"];
    if (user.assignmentTypes.includes("HEADTEACHER")) return ["CRECHE", "RECEPTION", "NURSERY", "PRIMARY"];
    return [];
  }

  private async resolveClassArmIdsForFeasibilityCheck(
    user: RequestUser,
    academicSessionId: string,
    targetGroup?: ClassLevelCategoryGroup | null,
  ): Promise<string[]> {
    const allowedCategories = this.resolveAllowedCategoriesFromUser(user);
    const categories = targetGroup ? allowedCategories.filter((c) => categoryToGroup(c) === targetGroup) : allowedCategories;
    const arms = await this.prisma.classArm.findMany({
      where: { academicSessionId, classLevel: { category: { in: categories } } },
      select: { id: true },
    });
    return arms.map((a) => a.id);
  }

  /**
   * Total subject-schedulable periods/week for a group — day-aware (Friday
   * may run a shorter FRIDAY_PERIODS_PER_DAY than the rest of the week) and
   * reduced by any SPECIAL_PERIODS fixed non-subject blocks (e.g. Wednesday
   * Sports/Extra-Curricular), same arithmetic apps/worker's
   * resolvePeriodStructure/resolveSpecialPeriodBlocks apply when building
   * the solver payload — re-derived here rather than shared, same
   * synchronous-before-any-queue-involvement reasoning as
   * resolveFlattenedRequiredSubjects above. `null` when PERIODS_PER_DAY
   * isn't configured yet (nothing to check against).
   */
  private async resolveWeeklyCapacity(group: ClassLevelCategoryGroup): Promise<number | null> {
    const rows = await this.prisma.schedulingConstraint.findMany({
      where: { scope: ScheduleScope.CLASS_TIMETABLE, classLevelCategoryGroup: group, isActive: true },
    });
    const get = (key: string): unknown => rows.find((r) => r.key === key)?.value;

    const periodsPerDayRaw = get("PERIODS_PER_DAY");
    if (periodsPerDayRaw === undefined) return null;
    const periodsPerDay = Number(periodsPerDayRaw);
    const fridayPeriodsPerDayRaw = get("FRIDAY_PERIODS_PER_DAY");
    const fridayPeriodsPerDay = fridayPeriodsPerDayRaw === undefined ? periodsPerDay : Number(fridayPeriodsPerDayRaw);
    const specialPeriods = parseSpecialPeriods(get("SPECIAL_PERIODS"));

    let capacity = 0;
    for (const day of DAYS_OF_WEEK) {
      const dayTotal = day === "FRIDAY" ? fridayPeriodsPerDay : periodsPerDay;
      const blockedForDay = specialPeriods
        .filter((s) => s.day === day)
        .reduce((sum, s) => sum + (s.endPeriod - s.startPeriod + 1), 0);
      capacity += Math.max(0, dayTotal - blockedForDay);
    }
    return capacity;
  }

  /**
   * Necessary-condition check only (mirrors the Python solver's own
   * per-subject fast-fail at class_timetable.py's `_solve_group`, just at
   * the aggregate weekly-capacity level) — it can't catch every possible
   * CP-SAT infeasibility (e.g. a teacher-availability deadlock), but it
   * catches an over-committed curriculum instantly, before a request is
   * even queued, instead of after a ~20s CP-SAT run comes back empty.
   */
  private async assertClassTimetableFeasible(dto: CreateScheduleGenerationRequestDto, user: RequestUser) {
    const term = await this.prisma.term.findUniqueOrThrow({ where: { id: dto.termId! } });

    const classArmIds = dto.classArmId
      ? [dto.classArmId]
      : await this.resolveClassArmIdsForFeasibilityCheck(user, term.academicSessionId, dto.classLevelCategoryGroup);

    const classArms = await this.prisma.classArm.findMany({
      where: { id: { in: classArmIds } },
      include: { classLevel: true },
    });

    const capacityByGroup = new Map<ClassLevelCategoryGroup, number | null>();
    const requiredByCategory = new Map<ClassLevelCategory, number>();
    const overshoots: string[] = [];

    for (const arm of classArms) {
      const group = categoryToGroup(arm.classLevel.category);
      if (!capacityByGroup.has(group)) {
        capacityByGroup.set(group, await this.resolveWeeklyCapacity(group));
      }
      const capacity = capacityByGroup.get(group) ?? null;
      if (capacity === null) continue; // period structure not configured yet — nothing to check against

      if (!requiredByCategory.has(arm.classLevel.category)) {
        const subjects = await this.resolveFlattenedRequiredSubjects(arm.classLevel.category);
        const seenGroups = new Set<string>();
        let total = 0;
        for (const s of subjects) {
          const key = s.concurrencyGroupId ?? s.id;
          if (seenGroups.has(key)) continue;
          seenGroups.add(key);
          total += s.periodsPerWeek;
        }
        requiredByCategory.set(arm.classLevel.category, total);
      }
      const required = requiredByCategory.get(arm.classLevel.category)!;

      if (required > capacity) {
        overshoots.push(`${arm.name} (${arm.classLevel.category}) needs ${required} periods/week but only ${capacity} are available`);
      }
    }

    if (overshoots.length > 0) {
      throw new BadRequestException(`Class timetable generation would be infeasible — ${overshoots.join("; ")}`);
    }
  }

  /** Every weekday (Mon-Fri) between start and end inclusive — same UTC-anchored arithmetic as the worker's own resolveWeekdayDates, duplicated here for the same "runs synchronously in the API" reason as resolveFlattenedRequiredSubjects above. */
  private resolveWeekdayCount(start: Date, end: Date): number {
    const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    const endUtc = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
    let count = 0;
    while (cursor.getTime() <= endUtc) {
      const day = cursor.getUTCDay();
      if (day !== 0 && day !== 6) count++;
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return count;
  }

  private async assertExamTimetableFeasible(dto: CreateScheduleGenerationRequestDto) {
    const component = await this.prisma.assessmentComponent.findUniqueOrThrow({
      where: { id: dto.assessmentComponentId! },
    });

    // assertValidExamTimetableRequest (called earlier in create()) already
    // guarantees these parse and fall within the component's term.
    const parameters = (dto.parameters ?? {}) as { examStartDate: string; examEndDate: string; maxSubjectsPerDay?: number };
    const dayCount = this.resolveWeekdayCount(new Date(parameters.examStartDate), new Date(parameters.examEndDate));

    const group = categoryToGroup(component.classLevelCategory);
    const prefix = component.type === AssessmentComponentType.MID_TERM ? "MID_TERM" : "EXAM";
    const groupConstraints = await this.prisma.schedulingConstraint.findMany({
      where: { scope: ScheduleScope.EXAM_TIMETABLE, classLevelCategoryGroup: group, isActive: true },
    });
    const maxSubjectsPerDay =
      parameters.maxSubjectsPerDay ?? Number(groupConstraints.find((c) => c.key === `${prefix}_MAX_SUBJECTS_PER_DAY`)?.value);
    if (!maxSubjectsPerDay) return; // not configured yet — nothing to check against

    const globalConstraints = await this.prisma.schedulingConstraint.findMany({
      where: { scope: ScheduleScope.EXAM_TIMETABLE, classLevelCategoryGroup: null, isActive: true },
    });
    const spreadCalculationSubjects =
      (globalConstraints.find((c) => c.key === "SPREAD_CALCULATION_SUBJECTS")?.value as boolean | undefined) ?? true;
    const minGap = Number(globalConstraints.find((c) => c.key === "MIN_GAP_BETWEEN_CALCULATION_EXAMS_DAYS")?.value ?? 0);

    const subjects = await this.resolveFlattenedRequiredSubjects(component.classLevelCategory);
    const seenGroups = new Set<string>();
    let distinctCount = 0;
    let calcCount = 0;
    for (const s of subjects) {
      const key = s.concurrencyGroupId ?? s.id;
      if (seenGroups.has(key)) continue;
      seenGroups.add(key);
      distinctCount++;
      if (s.requiresCalculation) calcCount++;
    }

    const reasons: string[] = [];
    const dayCapacity = dayCount * maxSubjectsPerDay;
    if (distinctCount > dayCapacity) {
      reasons.push(`${distinctCount} subjects need scheduling but only ${dayCapacity} exam-day slots exist (${dayCount} days × ${maxSubjectsPerDay}/day)`);
    }
    if (spreadCalculationSubjects && calcCount > dayCount) {
      reasons.push(`${calcCount} calculation subjects must be spread one per day, but only ${dayCount} exam days exist`);
    }
    if (minGap > 0 && calcCount > 1) {
      const minDaysNeeded = 1 + (calcCount - 1) * minGap;
      if (minDaysNeeded > dayCount) {
        reasons.push(`${calcCount} calculation subjects need at least ${minDaysNeeded} exam days (${minGap}-day gap apart) but only ${dayCount} exist`);
      }
    }

    if (reasons.length > 0) {
      throw new BadRequestException(`Exam timetable generation would be infeasible — ${reasons.join("; ")}`);
    }
  }

  async create(dto: CreateScheduleGenerationRequestDto, user: RequestUser) {
    // BUILD_PLAN.md §9 Step 2: TimetableSlot is already term-scoped (matching
    // manual CRUD), so a CLASS_TIMETABLE run generates exactly one term's
    // slots per solve — same granularity a human editing the timetable
    // manually already works at. termId stays a nullable column since
    // WEEKLY_DUTY also uses it, so this is a scope-specific service check,
    // not a schema-level requirement.
    if (dto.scope === "CLASS_TIMETABLE" && !dto.termId) {
      throw new BadRequestException("termId is required for CLASS_TIMETABLE scope");
    }
    if (dto.scope === "EXAM_TIMETABLE") {
      await this.assertValidExamTimetableRequest(dto);
    }
    if (dto.scope === "INVIGILATION") {
      await this.assertValidInvigilationRequest(dto);
    }
    if (dto.scope === "WEEKLY_DUTY") {
      await this.assertValidWeeklyDutyRequest(dto);
    }

    await this.assertCanTrigger(user, dto);

    // Fail fast with a specific reason before this ever reaches the queue —
    // same "state the reason it can't be generated before doing so" bar as
    // every guard above, just checking curriculum-vs-capacity math instead
    // of request shape.
    if (dto.scope === "CLASS_TIMETABLE") {
      await this.assertClassTimetableFeasible(dto, user);
    }
    if (dto.scope === "EXAM_TIMETABLE") {
      await this.assertExamTimetableFeasible(dto);
    }

    const request = await this.prisma.scheduleGenerationRequest.create({
      data: {
        scope: dto.scope,
        classArmId: dto.classArmId,
        assessmentComponentId: dto.assessmentComponentId,
        termId: dto.termId,
        classLevelCategoryGroup: dto.classLevelCategoryGroup,
        parameters: dto.parameters,
        callbackToken: randomBytes(32).toString("hex"),
        requestedByUserId: user.id,
      },
    });

    await this.dispatchQueue.add("dispatch", { requestId: request.id });
    return request;
  }

  findAll(filters: { scope?: ScheduleScope; status?: ScheduleGenerationStatus }) {
    return this.prisma.scheduleGenerationRequest.findMany({
      where: filters,
      orderBy: { requestedAt: "desc" },
    });
  }

  findOne(id: string) {
    return this.prisma.scheduleGenerationRequest.findUniqueOrThrow({ where: { id } });
  }

  /**
   * Single atomic approval for a whole generated roster — the requirement
   * that replaces per-row approve entirely (see the now-removed :id/approve
   * endpoints on TimetableSlotController/ExamScheduleController/
   * InvigilationAssignmentController/DutyAssignmentController). Every row
   * this run produced (`scheduleGenerationRequestId = id`) still sitting at
   * PENDING_REVIEW is re-checked with that row type's own assertNoConflicts
   * (same belt-and-suspenders precedent already used by the callback
   * controller when it first persisted them) and flipped to APPROVED in one
   * transaction, alongside the request's own reviewStatus.
   */
  async approve(id: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.scheduleGenerationRequest.findUniqueOrThrow({ where: { id } });
      if (request.reviewStatus !== TimetableApprovalStatus.PENDING_REVIEW) {
        throw new BadRequestException("Only a PENDING_REVIEW generation request can be approved");
      }

      const approvedAt = new Date();
      const approvalData = { approvalStatus: TimetableApprovalStatus.APPROVED, approvedByUserId: userId, approvedAt };
      const pendingFilter = { scheduleGenerationRequestId: id, approvalStatus: TimetableApprovalStatus.PENDING_REVIEW };

      if (request.scope === ScheduleScope.CLASS_TIMETABLE) {
        const rows = await tx.timetableSlot.findMany({ where: pendingFilter });
        for (const row of rows) await this.timetableSlots.assertNoConflicts(row, row.id, tx);
        await tx.timetableSlot.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: approvalData });
      }
      if (request.scope === ScheduleScope.EXAM_TIMETABLE) {
        const rows = await tx.examSchedule.findMany({ where: pendingFilter });
        for (const row of rows) await this.examSchedules.assertNoConflicts(row, row.id, tx);
        await tx.examSchedule.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: approvalData });
      }
      if (request.scope === ScheduleScope.INVIGILATION) {
        const rows = await tx.invigilationAssignment.findMany({ where: pendingFilter });
        for (const row of rows) await this.invigilationAssignments.assertNoConflicts(row.staffId, row.examScheduleId, tx);
        await tx.invigilationAssignment.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: approvalData });
      }
      if (request.scope === ScheduleScope.WEEKLY_DUTY) {
        // No per-row conflict check exists for DutyAssignment (no overlap
        // concept, only the whole-week @@unique constraint — same reasoning
        // DutyAssignmentService already documents).
        await tx.dutyAssignment.updateMany({ where: pendingFilter, data: approvalData });
      }

      return tx.scheduleGenerationRequest.update({
        where: { id },
        data: { reviewStatus: TimetableApprovalStatus.APPROVED, reviewedByUserId: userId, reviewedAt: approvedAt },
      });
    });
  }

  /** Rejects every still-PENDING_REVIEW row this run produced, in one transaction. */
  async reject(id: string, rejectionReason: string) {
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.scheduleGenerationRequest.findUniqueOrThrow({ where: { id } });
      if (request.reviewStatus !== TimetableApprovalStatus.PENDING_REVIEW) {
        throw new BadRequestException("Only a PENDING_REVIEW generation request can be rejected");
      }

      const rejectionData = { approvalStatus: TimetableApprovalStatus.REJECTED, rejectionReason };
      const pendingFilter = { scheduleGenerationRequestId: id, approvalStatus: TimetableApprovalStatus.PENDING_REVIEW };

      if (request.scope === ScheduleScope.CLASS_TIMETABLE) await tx.timetableSlot.updateMany({ where: pendingFilter, data: rejectionData });
      if (request.scope === ScheduleScope.EXAM_TIMETABLE) await tx.examSchedule.updateMany({ where: pendingFilter, data: rejectionData });
      if (request.scope === ScheduleScope.INVIGILATION)
        await tx.invigilationAssignment.updateMany({ where: pendingFilter, data: rejectionData });
      if (request.scope === ScheduleScope.WEEKLY_DUTY) await tx.dutyAssignment.updateMany({ where: pendingFilter, data: rejectionData });

      return tx.scheduleGenerationRequest.update({
        where: { id },
        data: { reviewStatus: TimetableApprovalStatus.REJECTED, rejectionReason },
      });
    });
  }
}

@Controller("schedule-generation-requests")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class ScheduleGenerationRequestController {
  constructor(private readonly service: ScheduleGenerationRequestService) {}

  @Post()
  @Audited("ScheduleGenerationRequest", "scheduleGenerationRequest")
  create(@Body() dto: CreateScheduleGenerationRequestDto, @CurrentUser() user: RequestUser) {
    return this.service.create(dto, user);
  }

  @Get()
  findAll(@Query("scope") scope?: ScheduleScope, @Query("status") status?: ScheduleGenerationStatus) {
    return this.service.findAll({ scope, status });
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  // Super-Admin only — the "only super-admin can approve" requirement.
  // Manage/generate/edit (Registrar/Principal/Headteacher/Admin) stays a
  // separate, broader grant on each row controller's own assertCanManage;
  // this is deliberately narrower, same manual-role-check style already
  // used for the (now-removed) per-row approve endpoints.
  @Patch(":id/approve")
  @Audited("ScheduleGenerationRequest", "scheduleGenerationRequest")
  approve(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    this.assertCanApproveBatch(user);
    return this.service.approve(id, user.id);
  }

  @Patch(":id/reject")
  @Audited("ScheduleGenerationRequest", "scheduleGenerationRequest")
  reject(@Param("id") id: string, @Body() dto: RejectScheduleRowDto, @CurrentUser() user: RequestUser) {
    this.assertCanApproveBatch(user);
    return this.service.reject(id, dto.rejectionReason);
  }

  private assertCanApproveBatch(user: RequestUser) {
    if (!user.roles.includes("SUPER_ADMIN")) {
      throw new ForbiddenException("Only Super-Admin can approve or reject a generated schedule roster");
    }
  }
}
