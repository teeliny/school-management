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
  normalizeSubjectName,
  parseSpecialPeriods,
  parseSubjectDayRestrictions,
  parseSyncAllSubjectsPoolEntries,
  QUEUE_NAMES,
  timeRangesOverlap,
  type ClassLevelCategoryGroup,
  type DayOfWeek,
  type PeriodStructure,
  type SchedulingSolveDispatchJob,
} from "@school/types";
import { PrismaService } from "../prisma/prisma.service";

// Creche has no ClassSubject rows (PRD §3.3 class list), so every
// timetable/schedule generation run excludes it — resolveAllowedCategories
// and buildExamTimetablePayload both filter against this instead of
// CLASS_LEVEL_CATEGORIES directly.
const GENERATION_CATEGORIES: ClassLevelCategory[] = CLASS_LEVEL_CATEGORIES.filter((c) => c !== "CRECHE");

interface RequiredSubject {
  id: string;
  // Only used to match against SUBJECT_ALLOWED_DAYS/SUBJECT_PREFER_MORNING
  // entries (keyed by Subject.name, case-insensitively — see
  // resolveSubjectDayPreferences) — never sent to the Python solver itself.
  name: string;
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
  // Display-only (Python solver's infeasibility error messages) — never
  // used for matching/solving there, that's all subjectId.
  subjectName: string;
  staffId: string;
  periodsPerWeek: number;
  requiresCalculation: boolean;
  concurrencyGroupId: string | null;
  // Hard/soft day-of-week scheduling preferences (SUBJECT_ALLOWED_DAYS/
  // SUBJECT_PREFER_MORNING/SUBJECT_PREFER_AFTERNOON, CLASS_TIMETABLE only) —
  // resolved here by subject name (see resolveSubjectDayPreferences) since
  // the SchedulingConstraint editor has no subjectId to reference.
  // undefined/false means "no restriction," today's behavior for every
  // subject that isn't configured. preferMorning/preferAfternoon are
  // mutually exclusive in practice (a subject configured under both
  // SUBJECT_PREFER_MORNING and SUBJECT_PREFER_AFTERNOON would just cancel
  // out in the solver's objective — not validated against here, same
  // "admin's responsibility" posture as every other SchedulingConstraint).
  allowedDays?: DayOfWeek[];
  preferMorning: boolean;
  preferAfternoon: boolean;
  // SYNC_ALL_SUBJECTS_CLASS_LEVEL_NAMES/SYNC_ALL_SUBJECTS_EXCLUDED_SUBJECT_NAMES
  // (CLASS_TIMETABLE only) — set (post-resolution, see
  // resolveWholeLevelSyncKeys) when this subject should be REWARDED (not
  // forced — see class_timetable.py's sync_reward_terms) for landing on the
  // identical (day, period) as every other ClassLevel in the same named
  // pool (e.g. "pool:PRIMARY_CLASS_TEACHERS::MATHEMATICS") — undefined means
  // "no pool, no alignment reward," today's behavior for every subject that
  // isn't configured, or one excluded by name (e.g. Music/Phonics/French,
  // taught by one roaming specialist who visits each arm at a DIFFERENT
  // time — those still schedule fully independently, just without the
  // reward nudging them toward a shared slot they structurally can't share).
  wholeLevelSyncKey?: string;
}

/** Parsed once per group by resolveSubjectDayPreferences — see its own comment. */
interface SubjectDayPreferences {
  allowedDaysBySubject: Map<string, DayOfWeek[]>;
  preferMorningSubjects: Set<string>;
  preferAfternoonSubjects: Set<string>;
}

interface ClassArmPayload {
  classArmId: string;
  // Display-only (Python solver's infeasibility error messages) — same
  // `${classLevel.name} ${arm.name}` convention as apps/api's withDisplayName
  // (e.g. class-arm.ts), computed here since the worker never imports apps/api.
  classArmDisplayName: string;
  // Lets the solver key a synced elective-block bundle (see
  // syncedElectiveClassLevelIds below) by ClassLevel instead of ClassArm.
  classLevelId: string;
  subjects: ResolvedSubject[];
  blockedPeriods: Record<string, number[]>;
}

interface GroupPayload extends PeriodStructure {
  group: ClassLevelCategoryGroup;
  days: DayOfWeek[];
  classArms: ClassArmPayload[];
  staffBlockedPeriods: Record<string, Record<string, number[]>>;
  // ClassLevel ids (always SSS, and only within this group when it's
  // JSS_SSS) whose arm count is within SYNC_SSS_ELECTIVE_BLOCKS_MAX_ARM_COUNT
  // — for these, the Python solver forces every arm's concurrency-group
  // members onto one shared slot per the whole ClassLevel rather than one
  // per arm. Empty for CRECHE_NURSERY_PRIMARY groups and for any SSS
  // ClassLevel over the threshold, which keep today's per-arm-independent
  // behavior.
  syncedElectiveClassLevelIds: string[];
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
    const syncSssElectiveBlocksAcrossArms =
      (globalConstraints.find((c) => c.key === "SYNC_SSS_ELECTIVE_BLOCKS_ACROSS_ARMS")?.value as boolean | undefined) ?? true;
    const syncSssElectiveBlocksMaxArmCount = Number(
      globalConstraints.find((c) => c.key === "SYNC_SSS_ELECTIVE_BLOCKS_MAX_ARM_COUNT")?.value ?? 3,
    );
    const syncAllSubjectsPoolIdByClassLevelName = new Map(
      parseSyncAllSubjectsPoolEntries(globalConstraints.find((c) => c.key === "SYNC_ALL_SUBJECTS_CLASS_LEVEL_NAMES")?.value).map(
        (entry) => [entry.classLevelName.trim().toUpperCase(), entry.poolId],
      ),
    );
    const syncAllSubjectsExcludedSubjectNames = this.parseGlobalNameSet(
      globalConstraints,
      "SYNC_ALL_SUBJECTS_EXCLUDED_SUBJECT_NAMES",
      normalizeSubjectName,
    );

    const groups: GroupPayload[] = [];
    for (const [group, arms] of armsByGroup) {
      const structure = await this.resolvePeriodStructure(group);
      // School-wide fixed blocks (e.g. Wednesday Sports/Extra-Curricular) —
      // same for every class arm in the group, unlike the per-arm/per-staff
      // TimetableSlot-based blocks below, so resolved once per group.
      const specialPeriodBlocks = await this.resolveSpecialPeriodBlocks(group);
      const subjectDayPreferences = await this.resolveSubjectDayPreferences(group);
      const syncedElectiveClassLevelIds = syncSssElectiveBlocksAcrossArms
        ? await this.resolveSyncedElectiveClassLevelIds(arms, term.academicSessionId, syncSssElectiveBlocksMaxArmCount)
        : [];
      const classArmPayloads: ClassArmPayload[] = [];
      const staffBlockedPeriods: Record<string, Record<string, number[]>> = {};

      for (const arm of arms) {
        const subjects = await this.resolveSubjectsForClassArm(
          arm.classLevel.category,
          arm.id,
          arm.classLevelId,
          term.academicSessionId,
          term.id,
          subjectDayPreferences,
        );
        const armSlots = existingSlots.filter((s) => s.classArmId === arm.id);
        classArmPayloads.push({
          classArmId: arm.id,
          classArmDisplayName: `${arm.classLevel.name} ${arm.name}`,
          classLevelId: arm.classLevelId,
          subjects,
          blockedPeriods: this.mergeBlockedPeriods(this.computeBlockedPeriods(structure, armSlots), specialPeriodBlocks),
        });

        for (const subject of subjects) {
          if (staffBlockedPeriods[subject.staffId]) continue;
          // excludeFromStaffAvailability rows are kept on their own arm's
          // timetable (armSlots above, unfiltered) but don't count as a real
          // commitment for this staff member anywhere else — see the schema
          // field's own comment.
          const staffSlots = existingSlots.filter((s) => s.staffId === subject.staffId && !s.excludeFromStaffAvailability);
          staffBlockedPeriods[subject.staffId] = this.computeBlockedPeriods(structure, staffSlots);
        }
      }

      if (syncAllSubjectsPoolIdByClassLevelName.size > 0) {
        this.resolveWholeLevelSyncKeys(classArmPayloads, arms, syncAllSubjectsPoolIdByClassLevelName, syncAllSubjectsExcludedSubjectNames);
      }

      groups.push({
        group,
        ...structure,
        days: DAYS_OF_WEEK,
        classArms: classArmPayloads,
        staffBlockedPeriods,
        syncedElectiveClassLevelIds,
      });
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
   * SYNC_ALL_SUBJECTS_CLASS_LEVEL_NAMES / SYNC_ALL_SUBJECTS_EXCLUDED_SUBJECT_NAMES
   * (CLASS_TIMETABLE, global) — both flat string-array constraint values,
   * matched by name (no ClassLevel/Subject picker in the generic constraint
   * editor) via a caller-supplied `normalize` so a class-level name and a
   * subject name can use different casing/whitespace conventions if needed.
   * Same "Array.isArray guard, filter to strings, normalize" shape as
   * resolveSubjectDayPreferences' preferMorningSubjects, factored out here
   * since this method is used for two different keys/normalizers.
   */
  private parseGlobalNameSet(
    rows: { key: string; value: unknown }[],
    key: string,
    normalize: (name: string) => string,
  ): Set<string> {
    const value = rows.find((r) => r.key === key)?.value;
    return new Set((Array.isArray(value) ? value : []).filter((v): v is string => typeof v === "string").map(normalize));
  }

  /**
   * SYNC_ALL_SUBJECTS_CLASS_LEVEL_NAMES/SYNC_ALL_SUBJECTS_EXCLUDED_SUBJECT_NAMES
   * — mutates each already-resolved ClassArmPayload's subjects in place,
   * setting `wholeLevelSyncKey` on every ResolvedSubject that should be
   * pooled with its same-named counterpart across every OTHER ClassLevel in
   * the same named pool (see parseSyncAllSubjectsPoolEntries's comment for
   * why pooling is by Subject.name, not Subject.id — pools commonly span
   * different ClassLevelCategory values with their own independent
   * ClassSubject catalogs, so "Mathematics" in RECEPTION and "Mathematics"
   * in NURSERY are typically two different Subject rows).
   *
   * Runs as a second pass AFTER every arm in the group has already been
   * resolved (not inline in resolveSubjectsForClassArm) because a pool's
   * membership spans arms resolved in different loop iterations — there's
   * nothing to bucket by name until every arm's subjects exist.
   *
   * Before pooling a (poolId, subjectName) bucket, every member must agree
   * on `periodsPerWeek` — the Python solver forces every bundle member onto
   * literally the same set of shared (day, period) BoolVars, so two members
   * requiring a DIFFERENT weekly count would be forcing that same shared sum
   * to equal two different values at once (guaranteed INFEASIBLE). Since
   * each pooled ClassLevel can independently set its own ClassSubject.
   * periodsPerWeek, this can genuinely happen — when it does, this logs a
   * warning and leaves every member of that bucket unsynced (falls back to
   * today's per-arm-independent scheduling for that one subject) rather
   * than handing the solver a model already known to be unsatisfiable. A
   * bucket with fewer than 2 members (the pool doesn't actually reach a
   * second arm/ClassLevel for this subject) is left unsynced too — nothing
   * to align with.
   */
  private resolveWholeLevelSyncKeys(
    classArmPayloads: ClassArmPayload[],
    arms: { classLevelId: string; classLevel: { name: string } }[],
    poolIdByClassLevelName: Map<string, string>,
    excludedSubjectNames: Set<string>,
  ): void {
    const poolIdByClassLevelId = new Map<string, string>();
    for (const arm of arms) {
      const poolId = poolIdByClassLevelName.get(arm.classLevel.name.trim().toUpperCase());
      if (poolId) poolIdByClassLevelId.set(arm.classLevelId, poolId);
    }
    if (poolIdByClassLevelId.size === 0) return;

    interface Bucket {
      periodsPerWeek: number;
      consistent: boolean;
      members: ResolvedSubject[];
    }
    const buckets = new Map<string, Bucket>();
    for (const armPayload of classArmPayloads) {
      const poolId = poolIdByClassLevelId.get(armPayload.classLevelId);
      if (!poolId) continue;
      for (const subject of armPayload.subjects) {
        const nameKey = normalizeSubjectName(subject.subjectName);
        if (excludedSubjectNames.has(nameKey)) continue;
        const bucketKey = `${poolId}::${nameKey}`;
        const bucket = buckets.get(bucketKey);
        if (!bucket) {
          buckets.set(bucketKey, { periodsPerWeek: subject.periodsPerWeek, consistent: true, members: [subject] });
        } else {
          if (subject.periodsPerWeek !== bucket.periodsPerWeek) bucket.consistent = false;
          bucket.members.push(subject);
        }
      }
    }

    for (const [bucketKey, bucket] of buckets) {
      if (!bucket.consistent) {
        this.logger.warn(
          `Whole-level sync skipped for "${bucketKey}" — pooled ClassLevels disagree on periodsPerWeek for this subject`,
        );
        continue;
      }
      if (bucket.members.length < 2) continue;
      for (const subject of bucket.members) subject.wholeLevelSyncKey = `pool:${bucketKey}`;
    }
  }

  /**
   * Which SSS ClassLevels among `arms` qualify for cross-arm elective-block
   * syncing — each one's real arm count (queried directly for the whole
   * ClassLevel, not just how many of its arms happen to be included in this
   * particular solve) at or below `maxArmCount`. JSS ClassLevels are
   * excluded even though they're part of the same JSS_SSS group — SSS-only
   * is a design decision, not derived from anything in the schema (see
   * SYNC_SSS_ELECTIVE_BLOCKS_ACROSS_ARMS's comment in packages/types/src/scheduling.ts).
   */
  private async resolveSyncedElectiveClassLevelIds(
    arms: { classLevelId: string; classLevel: { category: ClassLevelCategory } }[],
    academicSessionId: string,
    maxArmCount: number,
  ): Promise<string[]> {
    const sssClassLevelIds = [...new Set(arms.filter((a) => a.classLevel.category === "SSS").map((a) => a.classLevelId))];
    if (sssClassLevelIds.length === 0) return [];

    const armCounts = await this.prisma.classArm.groupBy({
      by: ["classLevelId"],
      where: { academicSessionId, classLevelId: { in: sssClassLevelIds } },
      _count: { _all: true },
    });
    return armCounts.filter((row) => row._count._all <= maxArmCount).map((row) => row.classLevelId);
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

    // Creche has no ClassSubject rows, so a component scoped to it (nothing
    // stops one from being created — CreateAssessmentComponentDto only
    // validates against the full ClassLevelCategory enum) has no exam to
    // schedule; skip it the same way GENERATION_CATEGORIES excludes CRECHE
    // from whole-scope class-timetable generation above.
    const examClassArms =
      component.classLevelCategory === ClassLevelCategory.CRECHE
        ? []
        : request.classArmId
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
        const requiredSubjects = await this.resolveRequiredSubjects(component.classLevelCategory, component.termId, classLevelId);
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
    // CRECHE is excluded from every whole-scope generation run — it has no
    // ClassSubject rows, so including it only wastes a solver slot producing
    // an empty schedule (Creche still exists for attendance/fees/RBAC scoping
    // elsewhere, e.g. resolvePrincipalHeadteacherCategories — don't touch that).
    if (roles.some((r) => r.role === Role.SUPER_ADMIN)) return GENERATION_CATEGORIES;

    const staffProfile = await this.prisma.staffProfile.findUnique({ where: { userId } });
    const assignments = staffProfile
      ? await this.prisma.staffAssignment.findMany({ where: { staffId: staffProfile.id, isActive: true } })
      : [];
    const types = new Set(assignments.map((a) => a.assignmentType));

    if (types.has("REGISTRAR")) return GENERATION_CATEGORIES;
    if (types.has("PRINCIPAL")) return ["JSS", "SSS"];
    if (types.has("HEADTEACHER")) return ["RECEPTION", "NURSERY", "PRIMARY"];

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
   * per-child split modeled yet). Shared between CLASS_TIMETABLE (which
   * further resolves a teacher per class arm on top) and EXAM_TIMETABLE
   * (which needs neither `periodsPerWeek` nor a teacher — a subject is
   * examined exactly once, and `ExamSchedule` has no `staffId`, PRD §3.8).
   * classLevelId narrows a category-wide ClassSubject down to one concrete
   * ClassLevel (e.g. NURSERY covers both "Nursery 1" and "Nursery 2") —
   * passed by both callers below so a subject explicitly disabled for one
   * ClassLevel (ClassSubjectLevelStatus) is never scheduled/examined for it,
   * even though it's still required for the rest of the category. termId is
   * always passed (both scopes always solve against one concrete term) so a
   * subject explicitly disabled for this term only (ClassSubjectTermStatus —
   * either the whole classSubject, or one child of a group) is excluded the
   * same way — this was the missing check score-entry/enrollment already
   * had (ClassSubjectTermStatusService.assertActiveForTerm) but this
   * resolver didn't, so a per-term-disabled subject still got scheduled/
   * examined and warned "no active SUBJECT_TEACHER" once no teacher was
   * bothered to be assigned for the term it's disabled in.
   */
  private async resolveRequiredSubjects(
    category: ClassLevelCategory,
    termId: string,
    classLevelId?: string,
  ): Promise<RequiredSubject[]> {
    const classSubjects = await this.prisma.classSubject.findMany({
      where: {
        classLevelCategory: category,
        ...(classLevelId ? { levelStatuses: { none: { classLevelId, isActive: false } } } : {}),
      },
      include: {
        subject: { include: { childSubjects: true } },
        childPeriodOverrides: true,
        // Only the disabled rows for this exact term — ClassSubjectTermStatus.subjectId
        // is either the classSubject's own subject (disables the whole
        // assignment, group or not) or one of a group's childSubjects
        // (disables just that child) — see schema.prisma's comment on the model.
        termStatuses: { where: { termId, isActive: false } },
      },
    });

    return classSubjects.flatMap((cs) => {
      if (cs.termStatuses.some((s) => s.subjectId === cs.subjectId)) return [];

      if (!cs.subject.isGroup) {
        return [
          {
            id: cs.subject.id,
            name: cs.subject.name,
            requiresCalculation: cs.subject.requiresCalculation,
            periodsPerWeek: cs.periodsPerWeek,
            concurrencyGroupId: cs.concurrencyGroupId,
          },
        ];
      }

      const disabledChildIds = new Set(cs.termStatuses.map((s) => s.subjectId));
      return cs.subject.childSubjects
        .filter((child) => !disabledChildIds.has(child.id))
        .map((child) => ({
          id: child.id,
          name: child.name,
          requiresCalculation: child.requiresCalculation,
          // A child inherits the parent ClassSubject row's periodsPerWeek
          // unless it has its own ClassSubjectChildPeriods override (e.g.
          // Basic Science and Technology's Physical and Health Education
          // running 2/week while its siblings run 3) — see that model's
          // schema.prisma comment for the sparse-override reasoning.
          periodsPerWeek: cs.childPeriodOverrides.find((o) => o.childSubjectId === child.id)?.periodsPerWeek ?? cs.periodsPerWeek,
          concurrencyGroupId: cs.concurrencyGroupId,
        }));
    });
  }

  private async resolveSubjectsForClassArm(
    category: ClassLevelCategory,
    classArmId: string,
    classLevelId: string,
    academicSessionId: string,
    termId: string,
    subjectDayPreferences: SubjectDayPreferences,
  ): Promise<ResolvedSubject[]> {
    const candidates = await this.resolveRequiredSubjects(category, termId, classLevelId);

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
      const nameKey = normalizeSubjectName(subject.name);
      resolved.push({
        subjectId: subject.id,
        subjectName: subject.name,
        staffId: assignment.staffId,
        periodsPerWeek: subject.periodsPerWeek,
        requiresCalculation: subject.requiresCalculation,
        concurrencyGroupId: subject.concurrencyGroupId,
        allowedDays: subjectDayPreferences.allowedDaysBySubject.get(nameKey),
        preferMorning: subjectDayPreferences.preferMorningSubjects.has(nameKey),
        preferAfternoon: subjectDayPreferences.preferAfternoonSubjects.has(nameKey),
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

  /**
   * SUBJECT_ALLOWED_DAYS (hard) / SUBJECT_PREFER_MORNING / SUBJECT_PREFER_AFTERNOON
   * (both soft, mutually exclusive per subject), CLASS_TIMETABLE only — all
   * keyed by Subject.name (normalizeSubjectName), not subjectId, since the
   * generic SchedulingConstraint editor has no subject picker (see
   * parseSubjectDayRestrictions' comment in @school/types). Parsed once per
   * group, same as resolveSpecialPeriodBlocks, then looked up per resolved
   * subject in resolveSubjectsForClassArm. The Python solver enforces
   * allowedDays as a hard per-day filter, preferMorning as an
   * objective-function preference for periods at/before breakAfterPeriod,
   * and preferAfternoon as the mirror-image preference for periods after it
   * — none restrict anything when unconfigured, same as today.
   */
  private async resolveSubjectDayPreferences(group: ClassLevelCategoryGroup): Promise<SubjectDayPreferences> {
    const rows = await this.prisma.schedulingConstraint.findMany({
      where: {
        scope: ScheduleScope.CLASS_TIMETABLE,
        classLevelCategoryGroup: group,
        key: { in: ["SUBJECT_ALLOWED_DAYS", "SUBJECT_PREFER_MORNING", "SUBJECT_PREFER_AFTERNOON"] },
        isActive: true,
      },
    });

    const allowedDaysBySubject = new Map<string, DayOfWeek[]>();
    const allowedDaysRow = rows.find((r) => r.key === "SUBJECT_ALLOWED_DAYS");
    for (const { subjectName, day } of parseSubjectDayRestrictions(allowedDaysRow?.value)) {
      const key = normalizeSubjectName(subjectName);
      const days = allowedDaysBySubject.get(key) ?? [];
      if (!days.includes(day)) days.push(day);
      allowedDaysBySubject.set(key, days);
    }

    const parseNameSet = (key: string): Set<string> => {
      const value = rows.find((r) => r.key === key)?.value;
      return new Set((Array.isArray(value) ? value : []).filter((v): v is string => typeof v === "string").map(normalizeSubjectName));
    };
    const preferMorningSubjects = parseNameSet("SUBJECT_PREFER_MORNING");
    const preferAfternoonSubjects = parseNameSet("SUBJECT_PREFER_AFTERNOON");

    return { allowedDaysBySubject, preferMorningSubjects, preferAfternoonSubjects };
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
