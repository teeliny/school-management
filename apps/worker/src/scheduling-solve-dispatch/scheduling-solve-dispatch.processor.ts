import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import {
  AssessmentComponentType,
  AssignmentType,
  ClassLevelCategory,
  Role,
  ScheduleGenerationStatus,
  ScheduleScope,
  StaffStatus,
  TimetableApprovalStatus,
} from "@prisma/client";
import {
  CLASS_LEVEL_CATEGORIES,
  categoryToGroup,
  computePeriodTime,
  DAYS_OF_WEEK,
  parseSpecialPeriods,
  QUEUE_NAMES,
  timeRangesOverlap,
  type ClassLevelCategoryGroup,
  type DayOfWeek,
  type PeriodStructure,
  type SchedulingSolveDispatchJob,
} from "@school/types";
import { PrismaService } from "../prisma/prisma.service";

interface RequiredSubject {
  id: string;
  requiresCalculation: boolean;
  periodsPerWeek: number;
  // "Options column" membership (ClassSubjectConcurrencyGroup) — subjects
  // sharing this id are mutually exclusive per student, so the class-
  // timetable/exam-timetable solvers schedule them in parallel (same period
  // slot / same exam day) instead of each reserving its own weekly capacity.
  concurrencyGroupId: string | null;
}

interface ResolvedSubject {
  subjectId: string;
  staffId: string;
  periodsPerWeek: number;
  requiresCalculation: boolean;
  concurrencyGroupId: string | null;
}

interface ClassArmPayload {
  classArmId: string;
  subjects: ResolvedSubject[];
  blockedPeriods: Record<string, number[]>;
}

interface GroupPayload extends PeriodStructure {
  group: ClassLevelCategoryGroup;
  days: DayOfWeek[];
  classArms: ClassArmPayload[];
  staffBlockedPeriods: Record<string, Record<string, number[]>>;
}

interface ExamSubjectPayload {
  subjectId: string;
  requiresCalculation: boolean;
  concurrencyGroupId: string | null;
}

interface ExamClassArmPayload {
  classArmId: string;
  subjects: ExamSubjectPayload[];
  existingByDate: Record<string, { count: number; hasCalc: boolean }>;
}

interface InvigilationExamPayload {
  examScheduleId: string;
  date: string;
  startTime: string;
  endTime: string;
  ownSubjectTeacherStaffId: string | null;
}

interface StaffExistingLoad {
  totalCount: number;
  countByDate: Record<string, number>;
  blockedRanges: { date: string; startTime: string; endTime: string }[];
}

interface WeeklyDutyGroupPayload {
  classLevelCategoryGroup: ClassLevelCategoryGroup;
  weeks: string[];
  teachersPerWeek: number;
  minWeeksBetweenRepeatDuty: number;
  eligibleStaffIds: string[];
  recentDutyByStaff: Record<string, string>;
}

/**
 * ARCHITECTURE.md §9: hands a solve request to the scheduling-engine and
 * flips the tracking row to SOLVING. `CLASS_TIMETABLE` (BUILD_PLAN.md §9
 * Step 2) gets a rich, pre-resolved payload (target class arms, required
 * subjects + their teachers, blocked periods) since the Python solver holds
 * no DB credentials (ARCHITECTURE.md §9) and can't resolve any of this
 * itself. Every other scope still gets Step 1's generic
 * {constraints, parameters} shape until its own step lands. If the dispatch
 * POST itself fails (scheduling-engine unreachable), the error propagates
 * and the ScheduleGenerationRequest is left QUEUED — the timeout sweep
 * catches it rather than this job retrying indefinitely, same "let the sweep
 * catch stragglers" shape as payment-reconciliation.
 */
@Processor(QUEUE_NAMES.SCHEDULING_SOLVE_DISPATCH)
export class SchedulingSolveDispatchProcessor extends WorkerHost {
  private readonly logger = new Logger(SchedulingSolveDispatchProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    super();
  }

  async process(job: Job<SchedulingSolveDispatchJob>): Promise<void> {
    const { requestId } = job.data;
    const request = await this.prisma.scheduleGenerationRequest.findUniqueOrThrow({ where: { id: requestId } });

    const engineUrl = this.config.getOrThrow<string>("SCHEDULING_ENGINE_URL");
    const callbackBaseUrl = this.config.getOrThrow<string>("SCHEDULING_CALLBACK_BASE_URL");
    // apps/api's global prefix is "api/v1" (main.ts's setGlobalPrefix),
    // excluded only for /health — every other route, including this
    // callback, needs it. SCHEDULING_CALLBACK_BASE_URL is a bare host, same
    // convention as apps/web's proxy route appending it itself.
    const callbackUrl = `${callbackBaseUrl}/api/v1/internal/scheduling-callback/${request.id}`;

    const payload =
      request.scope === ScheduleScope.CLASS_TIMETABLE
        ? await this.buildClassTimetablePayload(request, callbackUrl)
        : request.scope === ScheduleScope.EXAM_TIMETABLE
          ? await this.buildExamTimetablePayload(request, callbackUrl)
          : request.scope === ScheduleScope.INVIGILATION
            ? await this.buildInvigilationPayload(request, callbackUrl)
            : request.scope === ScheduleScope.WEEKLY_DUTY
              ? await this.buildWeeklyDutyPayload(request, callbackUrl)
              : await this.buildGenericPayload(request, callbackUrl);

    const response = await fetch(`${engineUrl}/solve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`scheduling-engine /solve returned ${response.status}`);
    }

    await this.prisma.scheduleGenerationRequest.update({
      where: { id: requestId },
      data: { status: ScheduleGenerationStatus.SOLVING },
    });
    this.logger.log(`Dispatched ${request.scope} solve for request ${requestId}`);
  }

  private async buildGenericPayload(
    request: { id: string; scope: ScheduleScope; parameters: unknown; callbackToken: string },
    callbackUrl: string,
  ) {
    const constraints = await this.prisma.schedulingConstraint.findMany({
      where: { scope: request.scope, isActive: true },
    });
    return {
      requestId: request.id,
      constraints: constraints.map((c) => ({ key: c.key, value: c.value })),
      parameters: request.parameters ?? {},
      callbackUrl,
      callbackToken: request.callbackToken,
    };
  }

  private async buildClassTimetablePayload(
    request: {
      id: string;
      termId: string | null;
      classArmId: string | null;
      classLevelCategoryGroup: ClassLevelCategoryGroup | null;
      requestedByUserId: string;
      callbackToken: string;
    },
    callbackUrl: string,
  ) {
    // Validated required at trigger time (ScheduleGenerationRequestService.create) —
    // re-checked here since the worker never trusts the job payload alone.
    if (!request.termId) throw new Error(`CLASS_TIMETABLE request ${request.id} is missing termId`);
    const term = await this.prisma.term.findUniqueOrThrow({ where: { id: request.termId } });

    const classArmIds = request.classArmId
      ? [request.classArmId]
      : await this.resolveWholeScopeClassArmIds(
          request.requestedByUserId,
          term.academicSessionId,
          request.classLevelCategoryGroup,
        );

    const classArms = await this.prisma.classArm.findMany({
      where: { id: { in: classArmIds } },
      include: { classLevel: true },
    });

    const armsByGroup = new Map<ClassLevelCategoryGroup, typeof classArms>();
    for (const arm of classArms) {
      const group = categoryToGroup(arm.classLevel.category);
      const list = armsByGroup.get(group) ?? [];
      list.push(arm);
      armsByGroup.set(group, list);
    }

    // Every existing (non-rejected) TimetableSlot for this term, fetched
    // once and filtered in memory per class arm/staff below — avoids one
    // query per arm/staff for what's typically a small per-term row count.
    const existingSlots = await this.prisma.timetableSlot.findMany({
      where: { termId: request.termId, approvalStatus: { not: TimetableApprovalStatus.REJECTED } },
    });

    const [globalConstraints] = await Promise.all([
      this.prisma.schedulingConstraint.findMany({
        where: { scope: ScheduleScope.CLASS_TIMETABLE, classLevelCategoryGroup: null, isActive: true },
      }),
    ]);
    const calculationSubjectsMorning = globalConstraints.find((c) => c.key === "CALCULATION_SUBJECTS_MORNING")
      ?.value as boolean | undefined;

    const groups: GroupPayload[] = [];
    for (const [group, arms] of armsByGroup) {
      const structure = await this.resolvePeriodStructure(group);
      // School-wide fixed blocks (e.g. Wednesday Sports/Extra-Curricular) —
      // same for every class arm in the group, unlike the per-arm/per-staff
      // TimetableSlot-based blocks below, so resolved once per group.
      const specialPeriodBlocks = await this.resolveSpecialPeriodBlocks(group);
      const classArmPayloads: ClassArmPayload[] = [];
      const staffBlockedPeriods: Record<string, Record<string, number[]>> = {};

      for (const arm of arms) {
        const subjects = await this.resolveSubjectsForClassArm(arm.classLevel.category, arm.id, arm.classLevelId, term.academicSessionId);
        const armSlots = existingSlots.filter((s) => s.classArmId === arm.id);
        classArmPayloads.push({
          classArmId: arm.id,
          subjects,
          blockedPeriods: this.mergeBlockedPeriods(this.computeBlockedPeriods(structure, armSlots), specialPeriodBlocks),
        });

        for (const subject of subjects) {
          if (staffBlockedPeriods[subject.staffId]) continue;
          const staffSlots = existingSlots.filter((s) => s.staffId === subject.staffId);
          staffBlockedPeriods[subject.staffId] = this.computeBlockedPeriods(structure, staffSlots);
        }
      }

      groups.push({ group, ...structure, days: DAYS_OF_WEEK, classArms: classArmPayloads, staffBlockedPeriods });
    }

    return {
      requestId: request.id,
      scope: ScheduleScope.CLASS_TIMETABLE,
      calculationSubjectsMorning: calculationSubjectsMorning ?? true,
      groups,
      callbackUrl,
      callbackToken: request.callbackToken,
    };
  }

  /**
   * BUILD_PLAN.md §9 Step 3: `AssessmentComponent.classLevelCategory`
   * already fixes the category (unlike CLASS_TIMETABLE, no Principal/
   * Headteacher re-derivation needed here — that authorization already
   * happened at trigger time), and `ExamSchedule` has no `staffId`, so this
   * payload needs neither a teacher lookup nor cross-class-arm constraints —
   * each class arm's exam schedule is solved independently by the Python
   * side (no shared teacher resource, no venue-capacity concept exists in
   * this codebase to contend over).
   */
  private async buildExamTimetablePayload(
    request: {
      id: string;
      assessmentComponentId: string | null;
      classArmId: string | null;
      parameters: unknown;
      callbackToken: string;
    },
    callbackUrl: string,
  ) {
    // Validated required at trigger time (ScheduleGenerationRequestService.assertValidExamTimetableRequest) —
    // re-checked here since the worker never trusts the job payload alone.
    if (!request.assessmentComponentId) throw new Error(`EXAM_TIMETABLE request ${request.id} is missing assessmentComponentId`);
    const component = await this.prisma.assessmentComponent.findUniqueOrThrow({
      where: { id: request.assessmentComponentId },
      include: { term: true },
    });

    const examClassArms = request.classArmId
      ? await this.prisma.classArm.findMany({ where: { id: request.classArmId }, select: { id: true, classLevelId: true } })
      : await this.prisma.classArm.findMany({
          where: { academicSessionId: component.term.academicSessionId, classLevel: { category: component.classLevelCategory } },
          select: { id: true, classLevelId: true },
        });
    const classArmIds = examClassArms.map((a) => a.id);

    // Required subjects are resolved per ClassLevel, not once for the whole
    // category — a subject assigned to the category but disabled for one
    // specific ClassLevel (ClassSubjectLevelStatus, e.g. "Nursery 1" within
    // NURSERY) must not get an exam scheduled for that ClassLevel's arms,
    // even though it's still required for the rest of the category. Cached
    // per classLevelId since several arms typically share one ClassLevel.
    const subjectPayloadsByLevel = new Map<string, ExamSubjectPayload[]>();
    const subjectPayloadsForLevel = async (classLevelId: string): Promise<ExamSubjectPayload[]> => {
      let payloads = subjectPayloadsByLevel.get(classLevelId);
      if (!payloads) {
        const requiredSubjects = await this.resolveRequiredSubjects(component.classLevelCategory, classLevelId);
        payloads = requiredSubjects.map((s) => ({
          subjectId: s.id,
          requiresCalculation: s.requiresCalculation,
          concurrencyGroupId: s.concurrencyGroupId,
        }));
        subjectPayloadsByLevel.set(classLevelId, payloads);
      }
      return payloads;
    };

    const parameters = (request.parameters ?? {}) as {
      examStartDate: string;
      examEndDate: string;
      maxSubjectsPerDay?: number;
      calculationSubjectDurationMinutes?: number;
      nonCalculationSubjectDurationMinutes?: number;
    };
    const examStartDate = new Date(parameters.examStartDate);
    const examEndDate = new Date(parameters.examEndDate);
    const days = this.resolveWeekdayDates(examStartDate, examEndDate);

    const group = categoryToGroup(component.classLevelCategory);
    // MID_TERM and EXAM share one duration-split mechanism (Step 3 design
    // decision) via separate key prefixes so both stay independently tunable.
    const prefix = component.type === AssessmentComponentType.MID_TERM ? "MID_TERM" : "EXAM";
    const groupConstraints = await this.prisma.schedulingConstraint.findMany({
      where: { scope: ScheduleScope.EXAM_TIMETABLE, classLevelCategoryGroup: group, isActive: true },
    });
    const getGroup = (key: string): unknown => groupConstraints.find((c) => c.key === key)?.value;

    const globalConstraints = await this.prisma.schedulingConstraint.findMany({
      where: { scope: ScheduleScope.EXAM_TIMETABLE, classLevelCategoryGroup: null, isActive: true },
    });
    const spreadCalculationSubjects =
      (globalConstraints.find((c) => c.key === "SPREAD_CALCULATION_SUBJECTS")?.value as boolean | undefined) ?? true;
    const minGapBetweenCalculationExamsDays = Number(
      globalConstraints.find((c) => c.key === "MIN_GAP_BETWEEN_CALCULATION_EXAMS_DAYS")?.value ?? 1,
    );

    const existingByClassArm = await this.summarizeExistingExamLoad(classArmIds, examStartDate, examEndDate);

    const classArms: ExamClassArmPayload[] = await Promise.all(
      examClassArms.map(async (arm) => ({
        classArmId: arm.id,
        subjects: await subjectPayloadsForLevel(arm.classLevelId),
        existingByDate: existingByClassArm[arm.id] ?? {},
      })),
    );

    return {
      requestId: request.id,
      scope: ScheduleScope.EXAM_TIMETABLE,
      days,
      examDayStartTime: String(getGroup("EXAM_DAY_START_TIME")),
      maxSubjectsPerDay: parameters.maxSubjectsPerDay ?? Number(getGroup(`${prefix}_MAX_SUBJECTS_PER_DAY`)),
      calculationSubjectDurationMinutes:
        parameters.calculationSubjectDurationMinutes ?? Number(getGroup(`${prefix}_CALCULATION_SUBJECT_DURATION_MINUTES`)),
      nonCalculationSubjectDurationMinutes:
        parameters.nonCalculationSubjectDurationMinutes ?? Number(getGroup(`${prefix}_NON_CALCULATION_SUBJECT_DURATION_MINUTES`)),
      spreadCalculationSubjects,
      minGapBetweenCalculationExamsDays,
      classArms,
      callbackUrl,
      callbackToken: request.callbackToken,
    };
  }

  /** Every weekday (Mon-Fri) between start and end inclusive, as "YYYY-MM-DD" strings. */
  private resolveWeekdayDates(start: Date, end: Date): string[] {
    const dates: string[] = [];
    const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    const endUtc = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
    while (cursor.getTime() <= endUtc) {
      const day = cursor.getUTCDay();
      if (day !== 0 && day !== 6) {
        dates.push(cursor.toISOString().slice(0, 10));
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return dates;
  }

  /**
   * Per class arm, per date already scheduled (any generatedBy, excluding
   * REJECTED): how many subjects already occupy it, and whether one of them
   * is a calculation subject — what the solver checks capacity/spread
   * against, playing the same role Step 2's blocked-period sets did.
   */
  private async summarizeExistingExamLoad(
    classArmIds: string[],
    from: Date,
    to: Date,
  ): Promise<Record<string, Record<string, { count: number; hasCalc: boolean }>>> {
    const existing = await this.prisma.examSchedule.findMany({
      where: {
        classArmId: { in: classArmIds },
        date: { gte: from, lte: to },
        approvalStatus: { not: TimetableApprovalStatus.REJECTED },
      },
      include: { subject: true },
    });

    const summary: Record<string, Record<string, { count: number; hasCalc: boolean }>> = {};
    for (const row of existing) {
      const dateKey = row.date.toISOString().slice(0, 10);
      const byDate = (summary[row.classArmId] ??= {});
      const entry = (byDate[dateKey] ??= { count: 0, hasCalc: false });
      entry.count += 1;
      if (row.subject.requiresCalculation) entry.hasCalc = true;
    }
    return summary;
  }

  /**
   * BUILD_PLAN.md §9 Step 4: unlike EXAM_TIMETABLE (independent per class
   * arm), staff are a shared, scarce resource across arms here — so this
   * builds ONE flat payload covering every target `ExamSchedule` row at
   * once, not grouped/independent. The trigger endpoint already enforced
   * that every matching `ExamSchedule` is `APPROVED` (the approval-order
   * decision for this step) — re-filtered here defensively rather than
   * trusted from the job payload, same "don't trust upstream" precedent as
   * every other branch.
   */
  private async buildInvigilationPayload(
    request: {
      id: string;
      assessmentComponentId: string | null;
      classArmId: string | null;
      parameters: unknown;
      callbackToken: string;
    },
    callbackUrl: string,
  ) {
    if (!request.assessmentComponentId) throw new Error(`INVIGILATION request ${request.id} is missing assessmentComponentId`);
    const component = await this.prisma.assessmentComponent.findUniqueOrThrow({
      where: { id: request.assessmentComponentId },
      include: { term: true },
    });

    const examSchedules = await this.prisma.examSchedule.findMany({
      where: {
        assessmentComponentId: request.assessmentComponentId,
        classArmId: request.classArmId ?? undefined,
        approvalStatus: TimetableApprovalStatus.APPROVED,
      },
    });

    const globalConstraints = await this.prisma.schedulingConstraint.findMany({
      where: { scope: ScheduleScope.INVIGILATION, classLevelCategoryGroup: null, isActive: true },
    });
    const maxInvigilationsPerStaffPerDay = Number(
      globalConstraints.find((c) => c.key === "MAX_INVIGILATIONS_PER_STAFF_PER_DAY")?.value ?? 2,
    );
    const excludedTypes =
      (globalConstraints.find((c) => c.key === "EXCLUDED_INVIGILATION_ASSIGNMENT_TYPES")?.value as string[] | undefined) ?? [];

    const parameters = (request.parameters ?? {}) as { includeNonTeachingStaff?: boolean };
    const eligibleStaffIds = await this.resolveEligibleInvigilatorIds(parameters.includeNonTeachingStaff === true, excludedTypes);

    // FR6.4: hard-exclude for JSS/SSS runs, soft preference only for
    // CRECHE/NURSERY/PRIMARY — derived once for the whole run from the
    // component's own classLevelCategory, since a run always targets one
    // component (one fixed category).
    const hardExcludeOwnSubjectTeacher = categoryToGroup(component.classLevelCategory) === "JSS_SSS";

    const exams: InvigilationExamPayload[] = [];
    for (const es of examSchedules) {
      const ownSubjectTeacherStaffId = await this.resolveOwnSubjectTeacher(
        es.subjectId,
        es.classArmId,
        component.term.academicSessionId,
      );
      exams.push({
        examScheduleId: es.id,
        date: es.date.toISOString().slice(0, 10),
        startTime: es.startTime,
        endTime: es.endTime,
        ownSubjectTeacherStaffId,
      });
    }

    const existingLoad = await this.resolveExistingInvigilationLoad(eligibleStaffIds);

    return {
      requestId: request.id,
      scope: ScheduleScope.INVIGILATION,
      maxInvigilationsPerStaffPerDay,
      hardExcludeOwnSubjectTeacher,
      exams,
      eligibleStaffIds,
      existingLoad,
      callbackUrl,
      callbackToken: request.callbackToken,
    };
  }

  /**
   * FR6.4: "the pool of active staff" minus the named exclusions — no
   * StaffCategory restriction stated in PRD. Per your Step 4 decision, the
   * teaching-only-vs-everyone choice is a run-time toggle
   * (`parameters.includeNonTeachingStaff`, default false/teaching-only,
   * mirroring FR6.11's stricter weekly-duty rule) rather than a fixed rule.
   */
  private async resolveEligibleInvigilatorIds(includeNonTeachingStaff: boolean, excludedTypes: string[]): Promise<string[]> {
    const excludedStaffIds = new Set(
      (
        await this.prisma.staffAssignment.findMany({
          where: { assignmentType: { in: excludedTypes as AssignmentType[] }, isActive: true },
          select: { staffId: true },
        })
      ).map((a) => a.staffId),
    );

    if (includeNonTeachingStaff) {
      const allStaff = await this.prisma.staffProfile.findMany({
        where: { status: StaffStatus.ACTIVE },
        select: { id: true },
      });
      return allStaff.map((s) => s.id).filter((id) => !excludedStaffIds.has(id));
    }

    const teachingAssignments = await this.prisma.staffAssignment.findMany({
      where: { assignmentType: { in: [AssignmentType.CLASS_TEACHER, AssignmentType.SUBJECT_TEACHER] }, isActive: true },
      select: { staffId: true },
    });
    const teachingStaffIds = new Set(teachingAssignments.map((a) => a.staffId));
    return [...teachingStaffIds].filter((id) => !excludedStaffIds.has(id));
  }

  /** Same active-SUBJECT_TEACHER lookup shape as Step 2's teacher resolution. */
  private async resolveOwnSubjectTeacher(
    subjectId: string,
    classArmId: string,
    academicSessionId: string,
  ): Promise<string | null> {
    const assignment = await this.prisma.staffAssignment.findFirst({
      where: {
        assignmentType: AssignmentType.SUBJECT_TEACHER,
        subjectId,
        classArmId,
        academicSessionId,
        isActive: true,
      },
    });
    return assignment?.staffId ?? null;
  }

  /**
   * Existing (non-rejected) InvigilationAssignment load per eligible staff
   * member — a total count (for the load-balancing objective, spanning
   * beyond just this run), a per-date count (for MAX_INVIGILATIONS_PER_
   * STAFF_PER_DAY), and blocked exam-time ranges (for cross-exam
   * double-booking, since a staff member could already be invigilating an
   * exam from an earlier, unrelated run at an overlapping time).
   */
  private async resolveExistingInvigilationLoad(staffIds: string[]): Promise<Record<string, StaffExistingLoad>> {
    const existing = await this.prisma.invigilationAssignment.findMany({
      where: { staffId: { in: staffIds }, approvalStatus: { not: TimetableApprovalStatus.REJECTED } },
      include: { examSchedule: true },
    });

    const summary: Record<string, StaffExistingLoad> = {};
    for (const row of existing) {
      const dateKey = row.examSchedule.date.toISOString().slice(0, 10);
      const entry = (summary[row.staffId] ??= { totalCount: 0, countByDate: {}, blockedRanges: [] });
      entry.totalCount += 1;
      entry.countByDate[dateKey] = (entry.countByDate[dateKey] ?? 0) + 1;
      entry.blockedRanges.push({ date: dateKey, startTime: row.examSchedule.startTime, endTime: row.examSchedule.endTime });
    }
    return summary;
  }

  /**
   * BUILD_PLAN.md §9 Step 5: unlike CLASS_TIMETABLE/EXAM_TIMETABLE (arm- or
   * category-scoped) and INVIGILATION (one flat combined payload), a
   * WEEKLY_DUTY run may cover one or both ClassLevelCategoryGroups at once
   * (a Super-Admin/Registrar combined run, FR6.11) — solved independently
   * per group since the two groups' staff pools are always disjoint (a
   * teacher's own class-arm assignments fix their group), same per-group
   * `groups[]` shape as Step 2's CLASS_TIMETABLE payload.
   */
  private async buildWeeklyDutyPayload(
    request: {
      id: string;
      termId: string | null;
      classLevelCategoryGroup: ClassLevelCategoryGroup | null;
      parameters: unknown;
      callbackToken: string;
    },
    callbackUrl: string,
  ) {
    if (!request.termId) throw new Error(`WEEKLY_DUTY request ${request.id} is missing termId`);
    const term = await this.prisma.term.findUniqueOrThrow({ where: { id: request.termId } });

    const targetGroups: ClassLevelCategoryGroup[] = request.classLevelCategoryGroup
      ? [request.classLevelCategoryGroup]
      : ["JSS_SSS", "CRECHE_NURSERY_PRIMARY"];

    const globalConstraints = await this.prisma.schedulingConstraint.findMany({
      where: { scope: ScheduleScope.WEEKLY_DUTY, classLevelCategoryGroup: null, isActive: true },
    });
    const defaultTeachersPerWeek = Number(globalConstraints.find((c) => c.key === "TEACHERS_PER_WEEK")?.value ?? 3);
    const minWeeksBetweenRepeatDuty = Number(
      globalConstraints.find((c) => c.key === "MIN_WEEKS_BETWEEN_REPEAT_DUTY")?.value ?? 4,
    );
    const excludedTypes =
      (globalConstraints.find((c) => c.key === "EXCLUDED_DUTY_ASSIGNMENT_TYPES")?.value as string[] | undefined) ?? [];

    const parameters = (request.parameters ?? {}) as { teachersPerWeek?: number };
    const teachersPerWeek = parameters.teachersPerWeek ?? defaultTeachersPerWeek;

    const weeks = this.resolveWeekStartDates(term.startDate, term.endDate);
    const firstWeek = weeks[0];

    const groups: WeeklyDutyGroupPayload[] = [];
    for (const group of targetGroups) {
      const eligibleStaffIds = await this.resolveEligibleDutyStaffIds(group, excludedTypes);
      const recentDutyByStaff = firstWeek
        ? await this.resolveRecentDutyByStaff(eligibleStaffIds, group, firstWeek, minWeeksBetweenRepeatDuty)
        : {};
      groups.push({
        classLevelCategoryGroup: group,
        weeks,
        teachersPerWeek,
        minWeeksBetweenRepeatDuty,
        eligibleStaffIds,
        recentDutyByStaff,
      });
    }

    return {
      requestId: request.id,
      scope: ScheduleScope.WEEKLY_DUTY,
      // "dutyGroups", not "groups" — CLASS_TIMETABLE's payload already owns
      // the "groups" field name on the shared SolveRequest Pydantic model
      // with a different element shape (GroupPayload vs WeeklyDutyGroupPayload).
      dutyGroups: groups,
      callbackUrl,
      callbackToken: request.callbackToken,
    };
  }

  /**
   * Every Monday-anchored week overlapping [start, end]: floor `start` to
   * that week's Monday, then step +7 days while the Monday is still <= end
   * — as "YYYY-MM-DD" strings, same UTC-anchored date arithmetic as
   * `resolveWeekdayDates`.
   */
  private resolveWeekStartDates(start: Date, end: Date): string[] {
    const startUtc = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    // getUTCDay(): 0=Sunday..6=Saturday. ISO week starts Monday (1); Sunday
    // needs a 6-day rewind, every other day rewinds (day - 1).
    const day = startUtc.getUTCDay();
    const rewindDays = day === 0 ? 6 : day - 1;
    startUtc.setUTCDate(startUtc.getUTCDate() - rewindDays);

    const endUtc = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
    const weeks: string[] = [];
    const cursor = new Date(startUtc);
    while (cursor.getTime() <= endUtc) {
      weeks.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
    return weeks;
  }

  /**
   * FR6.11's stricter pool (unlike invigilation's optional
   * includeNonTeachingStaff toggle): always active CLASS_TEACHER/
   * SUBJECT_TEACHER StaffAssignment holders, scoped to this group via their
   * classArm's ClassLevel.category, minus EXCLUDED_DUTY_ASSIGNMENT_TYPES.
   */
  private async resolveEligibleDutyStaffIds(group: ClassLevelCategoryGroup, excludedTypes: string[]): Promise<string[]> {
    const categories: ClassLevelCategory[] =
      group === "JSS_SSS" ? ["JSS", "SSS"] : ["CRECHE", "RECEPTION", "NURSERY", "PRIMARY"];

    const excludedStaffIds = new Set(
      (
        await this.prisma.staffAssignment.findMany({
          where: { assignmentType: { in: excludedTypes as AssignmentType[] }, isActive: true },
          select: { staffId: true },
        })
      ).map((a) => a.staffId),
    );

    const teachingAssignments = await this.prisma.staffAssignment.findMany({
      where: {
        assignmentType: { in: [AssignmentType.CLASS_TEACHER, AssignmentType.SUBJECT_TEACHER] },
        isActive: true,
        classArm: { classLevel: { category: { in: categories } } },
      },
      select: { staffId: true },
    });
    const teachingStaffIds = new Set(teachingAssignments.map((a) => a.staffId));
    return [...teachingStaffIds].filter((id) => !excludedStaffIds.has(id));
  }

  /**
   * Each eligible staff member's most recent pre-term DutyAssignment (any
   * non-REJECTED status) within `minWeeksBetweenRepeatDuty` weeks before the
   * term's first generated week — seeds the solver's gap-violation check for
   * the term's opening weeks so a staff member on duty the last week of the
   * previous term isn't immediately reassigned in week 1.
   */
  private async resolveRecentDutyByStaff(
    staffIds: string[],
    group: ClassLevelCategoryGroup,
    firstWeek: string,
    minWeeksBetweenRepeatDuty: number,
  ): Promise<Record<string, string>> {
    const lookbackFrom = new Date(firstWeek);
    lookbackFrom.setUTCDate(lookbackFrom.getUTCDate() - minWeeksBetweenRepeatDuty * 7);

    const rows = await this.prisma.dutyAssignment.findMany({
      where: {
        staffId: { in: staffIds },
        classLevelCategoryGroup: group,
        weekStartDate: { gte: lookbackFrom, lt: new Date(firstWeek) },
        approvalStatus: { not: TimetableApprovalStatus.REJECTED },
      },
      orderBy: { weekStartDate: "desc" },
    });

    const recent: Record<string, string> = {};
    for (const row of rows) {
      if (recent[row.staffId]) continue; // rows are DESC-ordered, so the first hit per staff is their most recent
      recent[row.staffId] = row.weekStartDate.toISOString().slice(0, 10);
    }
    return recent;
  }

  /**
   * FR6.2/PRD §5 footnote 5: a whole-scope (classArmId=null) trigger covers
   * every class arm within the *triggering user's own* scope — re-derived
   * here from the DB, not trusted from the original HTTP request, matching
   * Step 1's "re-fetch, don't embed" precedent (the job payload only carries
   * requestId). Mirrors ScheduleGenerationRequestService.assertCanTrigger's
   * scoping logic without duplicating its CASL/ForbiddenException shape —
   * this runs after the API has already authorized the trigger.
   */
  /**
   * `targetGroup`, when set, narrows a whole-scope run to just that group
   * (e.g. a Super-Admin retrying only JSS_SSS after CRECHE_NURSERY_PRIMARY
   * already solved) — intersected against the user's own allowed categories
   * so a Principal/Headteacher can't reach outside their assignment via this
   * param (already re-enforced as a no-op: `assertCanTrigger` rejects a
   * mismatched classLevelCategoryGroup for them before this job is ever
   * dispatched).
   */
  private async resolveWholeScopeClassArmIds(
    userId: string,
    academicSessionId: string,
    targetGroup?: ClassLevelCategoryGroup | null,
  ): Promise<string[]> {
    const allowedCategories = await this.resolveAllowedCategories(userId);
    const categories = targetGroup
      ? allowedCategories.filter((c) => categoryToGroup(c) === targetGroup)
      : allowedCategories;
    const arms = await this.prisma.classArm.findMany({
      where: { academicSessionId, classLevel: { category: { in: categories } } },
      select: { id: true },
    });
    return arms.map((a) => a.id);
  }

  private async resolveAllowedCategories(userId: string): Promise<ClassLevelCategory[]> {
    const roles = await this.prisma.userRole.findMany({ where: { userId, isActive: true } });
    if (roles.some((r) => r.role === Role.SUPER_ADMIN)) return [...CLASS_LEVEL_CATEGORIES];

    const staffProfile = await this.prisma.staffProfile.findUnique({ where: { userId } });
    const assignments = staffProfile
      ? await this.prisma.staffAssignment.findMany({ where: { staffId: staffProfile.id, isActive: true } })
      : [];
    const types = new Set(assignments.map((a) => a.assignmentType));

    if (types.has("REGISTRAR")) return [...CLASS_LEVEL_CATEGORIES];
    if (types.has("PRINCIPAL")) return ["JSS", "SSS"];
    if (types.has("HEADTEACHER")) return ["CRECHE", "RECEPTION", "NURSERY", "PRIMARY"];

    // The API's assertCanTrigger already rejected this case at trigger time
    // — reaching here means the user's assignment changed between trigger
    // and dispatch. Fail loudly rather than silently generating for nobody.
    throw new Error(`User ${userId} has no resolvable scope for CLASS_TIMETABLE generation`);
  }

  /**
   * PRD §3.3/CLAUDE.md: a `Subject` with `isGroup=true` is never itself
   * assignable — only its `childSubjects` are — so any subject list built
   * for scheduling must flatten group subjects, same pattern as
   * report-card.processor.ts's scoreSubjectIds flatMap. Each flattened
   * subject inherits its ClassSubject row's `periodsPerWeek` verbatim (no
   * per-child split modeled yet — a school with a group of many children
   * should tune periodsPerWeek down on that ClassSubject row accordingly).
   * A subject with no active SUBJECT_TEACHER for this exact class arm is
   * skipped — the solver has no one to assign it to.
   */
  /**
   * PRD §3.3/CLAUDE.md: a `Subject` with `isGroup=true` is never itself
   * assignable — only its `childSubjects` are — so any subject list built
   * for scheduling must flatten group subjects, same pattern as
   * report-card.processor.ts's scoreSubjectIds flatMap. Each flattened
   * subject inherits its ClassSubject row's `periodsPerWeek` verbatim (no
   * per-child split modeled yet). Shared between CLASS_TIMETABLE (which
   * further resolves a teacher per class arm on top) and EXAM_TIMETABLE
   * (which needs neither `periodsPerWeek` nor a teacher — a subject is
   * examined exactly once, and `ExamSchedule` has no `staffId`, PRD §3.8).
   * classLevelId narrows a category-wide ClassSubject down to one concrete
   * ClassLevel (e.g. NURSERY covers both "Nursery 1" and "Nursery 2") —
   * passed by both callers below so a subject explicitly disabled for one
   * ClassLevel (ClassSubjectLevelStatus) is never scheduled/examined for it,
   * even though it's still required for the rest of the category.
   */
  private async resolveRequiredSubjects(category: ClassLevelCategory, classLevelId?: string): Promise<RequiredSubject[]> {
    const classSubjects = await this.prisma.classSubject.findMany({
      where: {
        classLevelCategory: category,
        ...(classLevelId ? { levelStatuses: { none: { classLevelId, isActive: false } } } : {}),
      },
      include: { subject: { include: { childSubjects: true } }, childPeriodOverrides: true },
    });

    return classSubjects.flatMap((cs) =>
      cs.subject.isGroup
        ? cs.subject.childSubjects.map((child) => ({
            id: child.id,
            requiresCalculation: child.requiresCalculation,
            // A child inherits the parent ClassSubject row's periodsPerWeek
            // unless it has its own ClassSubjectChildPeriods override (e.g.
            // Basic Science and Technology's Physical and Health Education
            // running 2/week while its siblings run 3) — see that model's
            // schema.prisma comment for the sparse-override reasoning.
            periodsPerWeek: cs.childPeriodOverrides.find((o) => o.childSubjectId === child.id)?.periodsPerWeek ?? cs.periodsPerWeek,
            concurrencyGroupId: cs.concurrencyGroupId,
          }))
        : [
            {
              id: cs.subject.id,
              requiresCalculation: cs.subject.requiresCalculation,
              periodsPerWeek: cs.periodsPerWeek,
              concurrencyGroupId: cs.concurrencyGroupId,
            },
          ],
    );
  }

  private async resolveSubjectsForClassArm(
    category: ClassLevelCategory,
    classArmId: string,
    classLevelId: string,
    academicSessionId: string,
  ): Promise<ResolvedSubject[]> {
    const candidates = await this.resolveRequiredSubjects(category, classLevelId);

    const resolved: ResolvedSubject[] = [];
    for (const subject of candidates) {
      const assignment = await this.prisma.staffAssignment.findFirst({
        where: {
          assignmentType: "SUBJECT_TEACHER",
          subjectId: subject.id,
          classArmId,
          academicSessionId,
          isActive: true,
        },
      });
      if (!assignment) {
        this.logger.warn(`No active SUBJECT_TEACHER for subject ${subject.id} in class arm ${classArmId} — skipping`);
        continue;
      }
      resolved.push({
        subjectId: subject.id,
        staffId: assignment.staffId,
        periodsPerWeek: subject.periodsPerWeek,
        requiresCalculation: subject.requiresCalculation,
        concurrencyGroupId: subject.concurrencyGroupId,
      });
    }
    return resolved;
  }

  private async resolvePeriodStructure(group: ClassLevelCategoryGroup): Promise<PeriodStructure> {
    const rows = await this.prisma.schedulingConstraint.findMany({
      where: { scope: ScheduleScope.CLASS_TIMETABLE, classLevelCategoryGroup: group, isActive: true },
    });
    const get = (key: string): unknown => rows.find((r) => r.key === key)?.value;
    const periodsPerDay = Number(get("PERIODS_PER_DAY"));
    const periodDurationMinutes = Number(get("PERIOD_DURATION_MINUTES"));
    // The four keys below are optional (BUILD_PLAN.md §9 Step 2 follow-up) —
    // absent means "no short break" / "Friday is the same as every other
    // day," i.e. today's exact behavior before this pair of features existed.
    const shortBreakAfterPeriod = get("SHORT_BREAK_AFTER_PERIOD");
    const fridayPeriodsPerDay = get("FRIDAY_PERIODS_PER_DAY");
    return {
      periodsPerDay,
      periodDurationMinutes,
      schoolDayStartTime: String(get("SCHOOL_DAY_START_TIME")),
      breakAfterPeriod: Number(get("BREAK_AFTER_PERIOD")),
      breakDurationMinutes: Number(get("BREAK_DURATION_MINUTES")),
      fridayBreakDurationMinutes: Number(get("FRIDAY_BREAK_DURATION_MINUTES")),
      shortBreakAfterPeriod: shortBreakAfterPeriod === undefined ? periodsPerDay : Number(shortBreakAfterPeriod),
      shortBreakDurationMinutes: Number(get("SHORT_BREAK_DURATION_MINUTES") ?? 0),
      fridayPeriodDurationMinutes: Number(get("FRIDAY_PERIOD_DURATION_MINUTES") ?? periodDurationMinutes),
      fridayPeriodsPerDay: fridayPeriodsPerDay === undefined ? periodsPerDay : Number(fridayPeriodsPerDay),
    };
  }

  /**
   * School-wide fixed non-subject blocks (SPECIAL_PERIODS, e.g. Wednesday
   * Sports/Extra-Curricular) — parsed once per group and applied to every
   * class arm identically, unlike the per-arm TimetableSlot-based blocks
   * computeBlockedPeriods produces.
   */
  private async resolveSpecialPeriodBlocks(group: ClassLevelCategoryGroup): Promise<Record<string, number[]>> {
    const row = await this.prisma.schedulingConstraint.findFirst({
      where: { scope: ScheduleScope.CLASS_TIMETABLE, classLevelCategoryGroup: group, key: "SPECIAL_PERIODS", isActive: true },
    });
    const blocked = new Map<DayOfWeek, Set<number>>(DAYS_OF_WEEK.map((day) => [day, new Set<number>()]));
    for (const special of parseSpecialPeriods(row?.value)) {
      const daySet = blocked.get(special.day);
      if (!daySet) continue;
      for (let period = special.startPeriod; period <= special.endPeriod; period++) daySet.add(period);
    }
    return Object.fromEntries([...blocked.entries()].map(([day, set]) => [day, [...set]]));
  }

  private mergeBlockedPeriods(a: Record<string, number[]>, b: Record<string, number[]>): Record<string, number[]> {
    const merged: Record<string, number[]> = {};
    for (const day of DAYS_OF_WEEK) {
      merged[day] = [...new Set([...(a[day] ?? []), ...(b[day] ?? [])])];
    }
    return merged;
  }

  /**
   * Converts existing `TimetableSlot` rows into "which period index, which
   * day" they occupy, via `computePeriodTime` + the shared overlap check
   * (packages/types) — same minutes-since-midnight math
   * `TimetableSlotService.assertNoConflicts` uses, so a manually-entered
   * slot and a generated one are judged by identical logic. Bounded by each
   * day's own period count (Friday's own, possibly shorter, day) rather than
   * the flat periodsPerDay for every day.
   */
  private computeBlockedPeriods(
    structure: PeriodStructure,
    slots: { dayOfWeek: DayOfWeek; startTime: string; endTime: string }[],
  ): Record<string, number[]> {
    const blocked = new Map<DayOfWeek, Set<number>>(DAYS_OF_WEEK.map((day) => [day, new Set<number>()]));

    for (const slot of slots) {
      const daySlots = blocked.get(slot.dayOfWeek);
      if (!daySlots) continue;
      const maxPeriod = slot.dayOfWeek === "FRIDAY" ? structure.fridayPeriodsPerDay : structure.periodsPerDay;
      for (let period = 1; period <= maxPeriod; period++) {
        const { startTime, endTime } = computePeriodTime(structure, slot.dayOfWeek, period);
        if (timeRangesOverlap(startTime, endTime, slot.startTime, slot.endTime)) {
          daySlots.add(period);
        }
      }
    }

    return Object.fromEntries([...blocked.entries()].map(([day, set]) => [day, [...set]]));
  }
}
