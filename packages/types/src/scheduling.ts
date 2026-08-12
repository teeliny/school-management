/**
 * Mirrors the Prisma `ScheduleScope` enum (prisma/schema.prisma) — a plain
 * string union so apps/web can use it without depending on @prisma/client,
 * same pattern as notifications.ts's `NotificationType`.
 */
export type ScheduleScope = "CLASS_TIMETABLE" | "EXAM_TIMETABLE" | "INVIGILATION" | "WEEKLY_DUTY";

export interface DefaultSchedulingConstraint {
  scope: ScheduleScope;
  key: string;
  value: boolean | number | string[];
}

/**
 * Shipped defaults, seeded into `SchedulingConstraint` by `pnpm setup:school`
 * (apps/api/src/setup-school.ts) — Admin can tune any of these afterward via
 * `PATCH /scheduling-constraints/:id` without a code change (PRD §3.8).
 *
 * CALCULATION_SUBJECTS_MORNING/SPREAD_CALCULATION_SUBJECTS are seeded for
 * both CLASS_TIMETABLE (FR6.2) and EXAM_TIMETABLE (FR6.3) — the same rule
 * applies to routine class periods and exam slots, independently tunable per
 * scope since they're different SchedulingConstraint rows (@@unique([scope,
 * key])).
 */
export const DEFAULT_SCHEDULING_CONSTRAINTS: DefaultSchedulingConstraint[] = [
  { scope: "CLASS_TIMETABLE", key: "CALCULATION_SUBJECTS_MORNING", value: true },
  { scope: "CLASS_TIMETABLE", key: "SPREAD_CALCULATION_SUBJECTS", value: true },

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
