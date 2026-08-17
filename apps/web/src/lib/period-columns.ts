import { computePeriodTime, type DayOfWeek, type PeriodStructure } from "@school/types";

export type PeriodColumn =
  | { kind: "period"; index: number; startTime: string; endTime: string }
  | { kind: "break"; startTime: string; endTime: string };

/**
 * Fixed column layout for a period-structure grid: one column per period,
 * plus a single BREAK column inserted right after `breakAfterPeriod` —
 * matches the hand-drawn timetable grid (DAY/Class rows, one column per
 * period, a BREAK column) this UI is modeled on. Times are computed off
 * Monday (computePeriodTime's non-Friday branch) as the shared column
 * header — Friday's shorter break only shifts *clock times* for periods
 * after it, not which period index a slot falls in, so a slightly-off
 * Friday header time is an acceptable simplification; `resolvePeriodIndex`
 * below still places Friday's actual slots in the right column.
 */
export function buildPeriodColumns(structure: PeriodStructure): PeriodColumn[] {
  const columns: PeriodColumn[] = [];
  for (let index = 1; index <= structure.periodsPerDay; index++) {
    const { startTime, endTime } = computePeriodTime(structure, "MONDAY", index);
    columns.push({ kind: "period", index, startTime, endTime });
    if (index === structure.breakAfterPeriod && index < structure.periodsPerDay) {
      columns.push({ kind: "break", startTime: endTime, endTime: computePeriodTime(structure, "MONDAY", index + 1).startTime });
    }
  }
  return columns;
}

/**
 * Which period column (1-based) a stored slot's startTime falls in, for a
 * given day — computed against *that day's own* break duration (so Friday,
 * whose break is shorter, still resolves correctly) rather than against the
 * Monday-derived header labels from `buildPeriodColumns`. Returns `null` if
 * no period start matches (a slot from a stale/different period structure).
 */
export function resolvePeriodIndex(structure: PeriodStructure, dayOfWeek: DayOfWeek, startTime: string): number | null {
  for (let index = 1; index <= structure.periodsPerDay; index++) {
    if (computePeriodTime(structure, dayOfWeek, index).startTime === startTime) return index;
  }
  return null;
}
