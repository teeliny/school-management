import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import {
  ClassLevelCategory,
  Role,
  ScheduleGenerationStatus,
  ScheduleScope,
  TimetableApprovalStatus,
} from "@prisma/client";
import {
  CLASS_LEVEL_CATEGORIES,
  categoryToGroup,
  computePeriodTime,
  DAYS_OF_WEEK,
  QUEUE_NAMES,
  timeRangesOverlap,
  type ClassLevelCategoryGroup,
  type DayOfWeek,
  type PeriodStructure,
  type SchedulingSolveDispatchJob,
} from "@school/types";
import { PrismaService } from "../prisma/prisma.service";

interface ResolvedSubject {
  subjectId: string;
  staffId: string;
  periodsPerWeek: number;
  requiresCalculation: boolean;
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
    request: { id: string; termId: string | null; classArmId: string | null; requestedByUserId: string; callbackToken: string },
    callbackUrl: string,
  ) {
    // Validated required at trigger time (ScheduleGenerationRequestService.create) —
    // re-checked here since the worker never trusts the job payload alone.
    if (!request.termId) throw new Error(`CLASS_TIMETABLE request ${request.id} is missing termId`);
    const term = await this.prisma.term.findUniqueOrThrow({ where: { id: request.termId } });

    const classArmIds = request.classArmId
      ? [request.classArmId]
      : await this.resolveWholeScopeClassArmIds(request.requestedByUserId, term.academicSessionId);

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
    const spreadCalculationSubjects = globalConstraints.find((c) => c.key === "SPREAD_CALCULATION_SUBJECTS")
      ?.value as boolean | undefined;

    const groups: GroupPayload[] = [];
    for (const [group, arms] of armsByGroup) {
      const structure = await this.resolvePeriodStructure(group);
      const classArmPayloads: ClassArmPayload[] = [];
      const staffBlockedPeriods: Record<string, Record<string, number[]>> = {};

      for (const arm of arms) {
        const subjects = await this.resolveSubjectsForClassArm(arm.classLevel.category, arm.id, term.academicSessionId);
        const armSlots = existingSlots.filter((s) => s.classArmId === arm.id);
        classArmPayloads.push({
          classArmId: arm.id,
          subjects,
          blockedPeriods: this.computeBlockedPeriods(structure, armSlots),
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
      spreadCalculationSubjects: spreadCalculationSubjects ?? true,
      groups,
      callbackUrl,
      callbackToken: request.callbackToken,
    };
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
  private async resolveWholeScopeClassArmIds(userId: string, academicSessionId: string): Promise<string[]> {
    const categories = await this.resolveAllowedCategories(userId);
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
    if (types.has("HEADTEACHER")) return ["CRECHE", "NURSERY", "PRIMARY"];

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
  private async resolveSubjectsForClassArm(
    category: ClassLevelCategory,
    classArmId: string,
    academicSessionId: string,
  ): Promise<ResolvedSubject[]> {
    const classSubjects = await this.prisma.classSubject.findMany({
      where: { classLevelCategory: category },
      include: { subject: { include: { childSubjects: true } } },
    });

    const candidates = classSubjects.flatMap((cs) =>
      cs.subject.isGroup
        ? cs.subject.childSubjects.map((child) => ({ ...child, periodsPerWeek: cs.periodsPerWeek }))
        : [{ ...cs.subject, periodsPerWeek: cs.periodsPerWeek }],
    );

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
      });
    }
    return resolved;
  }

  private async resolvePeriodStructure(group: ClassLevelCategoryGroup): Promise<PeriodStructure> {
    const rows = await this.prisma.schedulingConstraint.findMany({
      where: { scope: ScheduleScope.CLASS_TIMETABLE, classLevelCategoryGroup: group, isActive: true },
    });
    const get = (key: string): unknown => rows.find((r) => r.key === key)?.value;
    return {
      periodsPerDay: Number(get("PERIODS_PER_DAY")),
      periodDurationMinutes: Number(get("PERIOD_DURATION_MINUTES")),
      schoolDayStartTime: String(get("SCHOOL_DAY_START_TIME")),
      breakAfterPeriod: Number(get("BREAK_AFTER_PERIOD")),
      breakDurationMinutes: Number(get("BREAK_DURATION_MINUTES")),
      fridayBreakDurationMinutes: Number(get("FRIDAY_BREAK_DURATION_MINUTES")),
    };
  }

  /**
   * Converts existing `TimetableSlot` rows into "which period index, which
   * day" they occupy, via `computePeriodTime` + the shared overlap check
   * (packages/types) — same minutes-since-midnight math
   * `TimetableSlotService.assertNoConflicts` uses, so a manually-entered
   * slot and a generated one are judged by identical logic.
   */
  private computeBlockedPeriods(
    structure: PeriodStructure,
    slots: { dayOfWeek: DayOfWeek; startTime: string; endTime: string }[],
  ): Record<string, number[]> {
    const blocked = new Map<DayOfWeek, Set<number>>(DAYS_OF_WEEK.map((day) => [day, new Set<number>()]));

    for (const slot of slots) {
      const daySlots = blocked.get(slot.dayOfWeek);
      if (!daySlots) continue;
      for (let period = 1; period <= structure.periodsPerDay; period++) {
        const { startTime, endTime } = computePeriodTime(structure, slot.dayOfWeek, period);
        if (timeRangesOverlap(startTime, endTime, slot.startTime, slot.endTime)) {
          daySlots.add(period);
        }
      }
    }

    return Object.fromEntries([...blocked.entries()].map(([day, set]) => [day, [...set]]));
  }
}
