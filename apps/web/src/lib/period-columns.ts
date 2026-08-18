import { computePeriodTime, type DayOfWeek, type PeriodStructure, type SpecialPeriod } from "@school/types";

export type PeriodColumn =
  | { kind: "period"; index: number; startTime: string; endTime: string }
  | { kind: "break"; startTime: string; endTime: string };

/**
 * Fixed column layout for a period-structure grid: one column per period,
 * plus a BREAK column inserted right after `breakAfterPeriod` and, when
 * configured, a second one after `shortBreakAfterPeriod` — matches the
 * hand-drawn timetable grid (DAY/Class rows, one column per period, a BREAK
 * column) this UI is modeled on. Times are computed off Monday
 * (computePeriodTime's non-Friday branch) as the shared column header —
 * Friday's own shorter/different day only shifts *clock times* and *how many
 * columns it actually uses* (see `fridayCutoffColumnIndex`), not this
 * Monday-derived header itself; `resolvePeriodIndex` below still places
 * Friday's actual slots in the right column.
 */
export function buildPeriodColumns(structure: PeriodStructure): PeriodColumn[] {
  const columns: PeriodColumn[] = [];
  for (let index = 1; index <= structure.periodsPerDay; index++) {
    const { startTime, endTime } = computePeriodTime(structure, "MONDAY", index);
    columns.push({ kind: "period", index, startTime, endTime });
    const isBreakPoint = index === structure.breakAfterPeriod || index === structure.shortBreakAfterPeriod;
    if (isBreakPoint && index < structure.periodsPerDay) {
      columns.push({ kind: "break", startTime: endTime, endTime: computePeriodTime(structure, "MONDAY", index + 1).startTime });
    }
  }
  return columns;
}

/**
 * Which period column (1-based) a stored slot's startTime falls in, for a
 * given day — computed against *that day's own* period duration/break
 * durations (so Friday, whose periods/breaks differ, still resolves
 * correctly) and bounded by that day's own period count (Friday may run
 * fewer) rather than against the Monday-derived header labels from
 * `buildPeriodColumns`. Returns `null` if no period start matches (a slot
 * from a stale/different period structure).
 */
export function resolvePeriodIndex(structure: PeriodStructure, dayOfWeek: DayOfWeek, startTime: string): number | null {
  const maxIndex = dayOfWeek === "FRIDAY" ? structure.fridayPeriodsPerDay : structure.periodsPerDay;
  for (let index = 1; index <= maxIndex; index++) {
    if (computePeriodTime(structure, dayOfWeek, index).startTime === startTime) return index;
  }
  return null;
}

/** The fixed non-subject block (if any) covering this day/period — e.g. Wednesday's Sports/Extra-Curricular. */
export function findSpecialPeriod(specialPeriods: SpecialPeriod[], day: DayOfWeek, periodIndex: number): SpecialPeriod | null {
  return specialPeriods.find((s) => s.day === day && periodIndex >= s.startPeriod && periodIndex <= s.endPeriod) ?? null;
}

/**
 * The `columns` array index of the last column Friday actually uses (its
 * final real period) — everything after this point in a Friday row should
 * collapse into one spanning cell (the trailing-activity label, if
 * configured) instead of rendering the remaining period/break columns
 * individually, since Friday's day already ended.
 */
export function fridayCutoffColumnIndex(structure: PeriodStructure, columns: PeriodColumn[]): number {
  const idx = columns.findIndex((col) => col.kind === "period" && col.index === structure.fridayPeriodsPerDay);
  return idx === -1 ? columns.length - 1 : idx;
}
