import { timeToMinutes } from "@school/types";

export type ExamColumn =
  | { kind: "paper"; startTime: string; endTime: string }
  | { kind: "break"; startTime: string; endTime: string };

export function minutesToTime(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Column layout for an exam-timetable grid, shaped like the class
 * timetable's `buildPeriodColumns` (a time-range header per column plus a
 * BREAK column) but derived from the loaded rows rather than a
 * PeriodStructure — exam days have no fixed period structure. The
 * scheduling engine lays papers on a unified slot grid
 * (exam_timetable.py `_slot_offset`): every slot is the same length, and
 * the configured {EXAM,MID_TERM}_BREAK_* break is the only place the gap
 * between consecutive slot starts exceeds that length. So the slot length
 * is taken as the smallest gap between distinct start times, and any
 * larger gap becomes a BREAK column. A column's end time is the latest end
 * among the papers starting there (calculation papers run longer than
 * non-calculation ones sharing the slot).
 */
export function buildExamColumns(rows: { startTime: string; endTime: string }[]): ExamColumn[] {
  const endByStart = new Map<number, number>();
  for (const row of rows) {
    const start = timeToMinutes(row.startTime);
    endByStart.set(start, Math.max(endByStart.get(start) ?? 0, timeToMinutes(row.endTime)));
  }
  const starts = [...endByStart.keys()].sort((a, b) => a - b);
  const gaps = starts.slice(1).map((start, i) => start - starts[i]!);
  const slotLength = gaps.length > 0 ? Math.min(...gaps) : 0;

  const columns: ExamColumn[] = [];
  starts.forEach((start, i) => {
    const end = endByStart.get(start)!;
    columns.push({ kind: "paper", startTime: minutesToTime(start), endTime: minutesToTime(end) });
    const next = starts[i + 1];
    if (next !== undefined && next - start > slotLength) {
      const breakStart = Math.max(end, start + slotLength);
      if (breakStart < next) columns.push({ kind: "break", startTime: minutesToTime(breakStart), endTime: minutesToTime(next) });
    }
  });
  return columns;
}

/** "Tue 27 Oct" — the exam grids' row label, the date-bearing equivalent of the class timetable's "Tue". */
export function formatExamDate(isoDate: string): string {
  // Parsed as UTC midnight (a bare YYYY-MM-DD), so format in UTC too —
  // local-time formatting west of UTC would show the previous day.
  return new Date(isoDate).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
