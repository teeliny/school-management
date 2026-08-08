/**
 * Mirrors the Prisma `AttendanceGranularity` enum (prisma/schema.prisma) —
 * whether a school day counts once or twice ("school days opened") toward
 * the attendance denominator. Shared so apps/web doesn't redeclare this list
 * locally and drift from the enum.
 */
export type AttendanceGranularity = "DAILY" | "MORNING_AND_AFTERNOON";

/**
 * PRD §3.7: "school-days-opened" is the count of times school opened over a
 * date range — every weekday minus declared `SchoolHoliday` dates, doubled
 * under MORNING_AND_AFTERNOON granularity. Pure and framework-free so both
 * apps/api (attendance analytics, built now) and apps/worker (the FULL_TERM
 * report card's attendance line, deferred) apply exactly the same rule
 * rather than two implementations drifting apart — same precedent as
 * `isStructureComplete` above.
 */
export function computeSchoolDaysOpened(
  range: { start: Date; end: Date },
  holidayDates: Date[],
  granularity: AttendanceGranularity,
): number {
  const holidayKeys = new Set(holidayDates.map(toDateKey));
  let weekdayCount = 0;

  const cursor = new Date(Date.UTC(range.start.getUTCFullYear(), range.start.getUTCMonth(), range.start.getUTCDate()));
  const end = new Date(Date.UTC(range.end.getUTCFullYear(), range.end.getUTCMonth(), range.end.getUTCDate()));

  while (cursor.getTime() <= end.getTime()) {
    const dayOfWeek = cursor.getUTCDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    if (!isWeekend && !holidayKeys.has(toDateKey(cursor))) {
      weekdayCount += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return granularity === "MORNING_AND_AFTERNOON" ? weekdayCount * 2 : weekdayCount;
}

function toDateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
}

/**
 * Shared so every attendance-analytics call site (student/class/staff) uses
 * the same rounding and the same null-when-nothing-opened behavior instead
 * of each re-deriving a divide-by-zero guard.
 */
export function computeAttendancePercentage(present: number, opened: number): number | null {
  if (opened <= 0) return null;
  return Math.round((present / opened) * 1000) / 10;
}
