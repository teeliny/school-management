// Staff attendance's daily 9am lock — distinct from the (day-granularity)
// attendanceBackdateWindowDays check both AttendanceSessionService and
// AttendanceRecordService already apply: that one governs how far into the
// past a session/record can be touched at all; this one additionally closes
// off *today's own* staff session once the clock passes 9am in the school's
// configured time zone, and — unlike the back-date window — nothing bypasses
// it except SUPER_ADMIN. Admin/Principal/Headteacher/Registrar share an
// unconditioned or STAFF-conditioned CASL grant on AttendanceSession today
// (see checkIsAdminOverride in both services), so this has to be a separate,
// role-literal check rather than another CASL rule — CASL has no notion of
// "the current wall-clock hour" to condition a grant on.
export const STAFF_ATTENDANCE_LOCK_HOUR = 9;

function partsInTimeZone(date: Date, timeZone: string): { calendarDate: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  // Intl renders midnight as "24" under hour12: false for some locale/ICU
  // combinations rather than "00" — normalize so callers never see 1-24.
  const rawHour = Number(get("hour"));
  const hour = rawHour === 24 ? 0 : rawHour;
  return { calendarDate: `${get("year")}-${get("month")}-${get("day")}`, hour };
}

/**
 * True once it's `STAFF_ATTENDANCE_LOCK_HOUR`:00 or later, in `timezone`, on
 * the same calendar day as `sessionDate` itself — a STAFF session for
 * yesterday or any earlier day is governed by the back-date window instead,
 * not this lock. `sessionDate` is a Prisma `@db.Date` value (stored/returned
 * as UTC midnight for that calendar day, no real time-of-day component), so
 * it's read via its UTC Y-M-D directly rather than re-interpreted through
 * `timezone` — reinterpreting it would shift which calendar day it names.
 */
export function isStaffAttendanceLockedForToday(sessionDate: Date, timezone: string, now: Date = new Date()): boolean {
  const sessionCalendarDate = sessionDate.toISOString().slice(0, 10);
  const { calendarDate: todayCalendarDate, hour } = partsInTimeZone(now, timezone);
  if (sessionCalendarDate !== todayCalendarDate) return false;
  return hour >= STAFF_ATTENDANCE_LOCK_HOUR;
}
