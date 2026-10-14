// buildExamColumns/minutesToTime live in @school/types (shared with the API's
// exam timetable PDF so screen and download lay columns out identically).
export { buildExamColumns, minutesToTime, type ExamColumn } from "@school/types";

/** "Tue 27 Oct" — the exam grids' row label, the date-bearing equivalent of the class timetable's "Tue". */
export function formatExamDate(isoDate: string): string {
  // Parsed as UTC midnight (a bare YYYY-MM-DD), so format in UTC too —
  // local-time formatting west of UTC would show the previous day.
  return new Date(isoDate).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
