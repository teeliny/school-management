import type { ClassLevelCategory } from "./class-level-category";

/**
 * Mirrors the Prisma `ScheduleScope` enum (prisma/schema.prisma) — a plain
 * string union so apps/web can use it without depending on @prisma/client,
 * same pattern as notifications.ts's `NotificationType`.
 */
export type ScheduleScope = "CLASS_TIMETABLE" | "EXAM_TIMETABLE" | "INVIGILATION" | "WEEKLY_DUTY";

/** Mirrors the Prisma `ClassLevelCategoryGroup` enum. */
export type ClassLevelCategoryGroup = "JSS_SSS" | "CRECHE_NURSERY_PRIMARY";

/** Mirrors the Prisma `DayOfWeek` enum. */
export type DayOfWeek = "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY";

export const DAYS_OF_WEEK: DayOfWeek[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];

/**
 * PRD §3.8/§6.6 footnote 5: the same JSS/SSS vs. Creche/Nursery/Primary split
 * used throughout AI scheduling to scope Principal/Headteacher triggers.
 * `ClassLevelCategory` is the finer-grained enum `ClassSubject`/
 * `AssessmentComponent`/etc. are scoped to; this collapses it to the coarser
 * group used for period structure and Principal/Headteacher access.
 */
export function categoryToGroup(category: ClassLevelCategory): ClassLevelCategoryGroup {
  return category === "JSS" || category === "SSS" ? "JSS_SSS" : "CRECHE_NURSERY_PRIMARY";
}

export interface DefaultSchedulingConstraint {
  scope: ScheduleScope;
  // null/omitted = applies to the whole scope; set = per-group override —
  // see the SchedulingConstraint model comment (prisma/schema.prisma).
  classLevelCategoryGroup?: ClassLevelCategoryGroup;
  key: string;
  value: boolean | number | string | string[];
}

/**
 * Shipped defaults, seeded into `SchedulingConstraint` by `pnpm setup:school`
 * (apps/api/src/setup-school.ts) — Admin can tune any of these afterward via
 * `PATCH /scheduling-constraints/:id` without a code change (PRD §3.8).
 *
 * CALCULATION_SUBJECTS_MORNING/SPREAD_CALCULATION_SUBJECTS are seeded for
 * both CLASS_TIMETABLE (FR6.2) and EXAM_TIMETABLE (FR6.3) — the same rule
 * applies to routine class periods and exam slots, independently tunable per
 * scope. Both stay global (no classLevelCategoryGroup) — unlike the period/
 * break keys below, nothing suggested these should vary by group.
 *
 * The CLASS_TIMETABLE period/break keys are seeded per group — BUILD_PLAN.md
 * §9 Step 2: there is no existing concept of teaching periods anywhere in
 * this codebase, so these were newly designed; JSS_SSS and
 * CRECHE_NURSERY_PRIMARY commonly differ in periods/day and period length in
 * practice. Values below are placeholder defaults, not exact for any real
 * school — Admin tunes them via the SchedulingConstraint CRUD.
 */
export const DEFAULT_SCHEDULING_CONSTRAINTS: DefaultSchedulingConstraint[] = [
  { scope: "CLASS_TIMETABLE", key: "CALCULATION_SUBJECTS_MORNING", value: true },
  { scope: "CLASS_TIMETABLE", key: "SPREAD_CALCULATION_SUBJECTS", value: true },

  { scope: "CLASS_TIMETABLE", classLevelCategoryGroup: "JSS_SSS", key: "PERIODS_PER_DAY", value: 8 },
  { scope: "CLASS_TIMETABLE", classLevelCategoryGroup: "JSS_SSS", key: "PERIOD_DURATION_MINUTES", value: 40 },
  { scope: "CLASS_TIMETABLE", classLevelCategoryGroup: "JSS_SSS", key: "SCHOOL_DAY_START_TIME", value: "08:00" },
  { scope: "CLASS_TIMETABLE", classLevelCategoryGroup: "JSS_SSS", key: "BREAK_AFTER_PERIOD", value: 5 },
  { scope: "CLASS_TIMETABLE", classLevelCategoryGroup: "JSS_SSS", key: "BREAK_DURATION_MINUTES", value: 30 },
  { scope: "CLASS_TIMETABLE", classLevelCategoryGroup: "JSS_SSS", key: "FRIDAY_BREAK_DURATION_MINUTES", value: 20 },

  {
    scope: "CLASS_TIMETABLE",
    classLevelCategoryGroup: "CRECHE_NURSERY_PRIMARY",
    key: "PERIODS_PER_DAY",
    value: 6,
  },
  {
    scope: "CLASS_TIMETABLE",
    classLevelCategoryGroup: "CRECHE_NURSERY_PRIMARY",
    key: "PERIOD_DURATION_MINUTES",
    value: 35,
  },
  {
    scope: "CLASS_TIMETABLE",
    classLevelCategoryGroup: "CRECHE_NURSERY_PRIMARY",
    key: "SCHOOL_DAY_START_TIME",
    value: "08:00",
  },
  {
    scope: "CLASS_TIMETABLE",
    classLevelCategoryGroup: "CRECHE_NURSERY_PRIMARY",
    key: "BREAK_AFTER_PERIOD",
    value: 4,
  },
  {
    scope: "CLASS_TIMETABLE",
    classLevelCategoryGroup: "CRECHE_NURSERY_PRIMARY",
    key: "BREAK_DURATION_MINUTES",
    value: 30,
  },
  {
    scope: "CLASS_TIMETABLE",
    classLevelCategoryGroup: "CRECHE_NURSERY_PRIMARY",
    key: "FRIDAY_BREAK_DURATION_MINUTES",
    value: 20,
  },

  { scope: "EXAM_TIMETABLE", key: "CALCULATION_SUBJECTS_MORNING", value: true },
  { scope: "EXAM_TIMETABLE", key: "SPREAD_CALCULATION_SUBJECTS", value: true },
  { scope: "EXAM_TIMETABLE", key: "MIN_GAP_BETWEEN_CALCULATION_EXAMS_DAYS", value: 1 },
  { scope: "EXAM_TIMETABLE", key: "MID_TERM_MAX_SUBJECTS_PER_DAY", value: 2 },
  { scope: "EXAM_TIMETABLE", key: "MID_TERM_CALCULATION_SUBJECT_DURATION_MINUTES", value: 90 },
  { scope: "EXAM_TIMETABLE", key: "MID_TERM_NON_CALCULATION_SUBJECT_DURATION_MINUTES", value: 60 },

  { scope: "INVIGILATION", key: "MAX_INVIGILATIONS_PER_STAFF_PER_DAY", value: 2 },
  {
    scope: "INVIGILATION",
    key: "EXCLUDED_INVIGILATION_ASSIGNMENT_TYPES",
    value: ["BURSAR", "PRINCIPAL", "VICE_PRINCIPAL"],
  },

  { scope: "WEEKLY_DUTY", key: "TEACHERS_PER_WEEK", value: 3 },
  {
    scope: "WEEKLY_DUTY",
    key: "EXCLUDED_DUTY_ASSIGNMENT_TYPES",
    value: ["BURSAR", "PRINCIPAL", "VICE_PRINCIPAL"],
  },
  { scope: "WEEKLY_DUTY", key: "MIN_WEEKS_BETWEEN_REPEAT_DUTY", value: 4 },
];

/**
 * A `CLASS_TIMETABLE` generation run's resolved per-group period grid — the
 * six `SchedulingConstraint` keys above, typed and named for direct use by
 * `computePeriodTime`/the worker's blocked-period computation. The Python
 * solver receives the same six values in its payload and computes identical
 * arithmetic independently (see BUILD_PLAN.md §9 Step 2) — this type is not
 * shared across the process/language boundary, only the shape of the values.
 */
export interface PeriodStructure {
  periodsPerDay: number;
  periodDurationMinutes: number;
  schoolDayStartTime: string; // "HH:mm"
  breakAfterPeriod: number;
  breakDurationMinutes: number;
  fridayBreakDurationMinutes: number;
}

function minutesToTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * BUILD_PLAN.md §9 Step 2: `periodIndex` (1-based) -> actual clock time,
 * inserting the day's one break gap after `breakAfterPeriod` — using
 * `fridayBreakDurationMinutes` instead of `breakDurationMinutes` on Fridays,
 * per the break-modeling decision made for this step. Periods before the
 * break are unaffected; every period after it shifts later by the break's
 * duration.
 */
export function computePeriodTime(
  structure: PeriodStructure,
  dayOfWeek: DayOfWeek,
  periodIndex: number,
): { startTime: string; endTime: string } {
  const [startHour, startMinute] = structure.schoolDayStartTime.split(":").map(Number) as [number, number];
  const dayStartMinutes = startHour * 60 + startMinute;
  const breakMinutes = dayOfWeek === "FRIDAY" ? structure.fridayBreakDurationMinutes : structure.breakDurationMinutes;

  let periodStartMinutes = dayStartMinutes + (periodIndex - 1) * structure.periodDurationMinutes;
  if (periodIndex > structure.breakAfterPeriod) {
    periodStartMinutes += breakMinutes;
  }

  return {
    startTime: minutesToTime(periodStartMinutes),
    endTime: minutesToTime(periodStartMinutes + structure.periodDurationMinutes),
  };
}

/** "HH:mm" -> minutes since midnight. */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":");
  return Number(h) * 60 + Number(m);
}

/**
 * Shared with `TimetableSlotService.assertNoConflicts` (apps/api) so the
 * worker's blocked-period computation (BUILD_PLAN.md §9 Step 2) and the
 * API's own manual-entry conflict check use identical minutes-since-midnight
 * overlap math rather than two implementations that could drift.
 */
export function timeRangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return timeToMinutes(aStart) < timeToMinutes(bEnd) && timeToMinutes(bStart) < timeToMinutes(aEnd);
}
