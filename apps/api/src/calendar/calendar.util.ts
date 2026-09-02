export interface CalendarTermInput {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
}

export interface CalendarComponentInput {
  id: string;
  name: string;
  termId: string;
  classLevelCategory: string;
  // Null on a freshly carried-forward component (TermService.create) until
  // Admin sets it for the new term — contributes no calendar entry for that
  // date field until then.
  inputOpensAt: Date | null;
  inputClosesAt: Date | null;
  publishAt: Date | null;
}

export interface CalendarWindowInput {
  id: string;
  termId: string;
  classLevelCategory: string;
  inputOpensAt: Date;
  inputClosesAt: Date;
}

export interface CalendarHolidayInput {
  id: string;
  name: string;
  date: Date;
}

export interface CalendarSchoolEventInput {
  id: string;
  name: string;
  date: Date;
  endDate: Date | null;
}

// The actual mid-term/exam sitting period for one AssessmentComponent — the
// min/max `ExamSchedule.date` across every class arm/subject slot scheduled
// against it (APPROVED only; see calendar.ts), not the component's own
// inputOpensAt/inputClosesAt (that's the score-entry window subject teachers
// work within, which can stay open well after the exams themselves are over
// — a parent cares when the test happens, not when it's safe to grade it).
export interface CalendarComponentScheduleInput {
  componentId: string;
  name: string;
  minDate: Date;
  maxDate: Date;
}

export interface CalendarEntry {
  type:
    | "TERM"
    | "ASSESSMENT_OPEN"
    | "ASSESSMENT_CLOSE"
    | "ASSESSMENT_PUBLISH"
    | "EXAM_PERIOD"
    | "REPORT_WINDOW_OPEN"
    | "REPORT_WINDOW_CLOSE"
    | "HOLIDAY"
    | "SCHOOL_EVENT";
  title: string;
  date: Date;
  endDate?: Date;
  meta?: Record<string, string>;
}

/**
 * PRD §3.11: "a read-aggregation across dates that already live in their
 * owning tables" — no calendar table of its own. Pure and Prisma-free so the
 * date-range/shaping logic is directly testable; the service (calendar.ts)
 * does the actual fetching and passes rows straight through. A Term "spans"
 * the query range (overlap check, not a point-in-range check) since it has
 * both a start and end date; AssessmentComponent/ReportWindow contribute one
 * point entry per date field that actually falls inside [from, to].
 */
export function buildCalendarEntries(
  terms: CalendarTermInput[],
  components: CalendarComponentInput[],
  windows: CalendarWindowInput[],
  holidays: CalendarHolidayInput[],
  schoolEvents: CalendarSchoolEventInput[],
  examSchedules: CalendarComponentScheduleInput[],
  from: Date,
  to: Date,
): CalendarEntry[] {
  const inRange = (date: Date) => date >= from && date <= to;
  const entries: CalendarEntry[] = [];

  for (const term of terms) {
    if (term.startDate <= to && term.endDate >= from) {
      entries.push({ type: "TERM", title: term.name, date: term.startDate, endDate: term.endDate, meta: { termId: term.id } });
    }
  }

  for (const component of components) {
    const meta = { componentId: component.id, termId: component.termId, classLevelCategory: component.classLevelCategory };
    if (component.inputOpensAt && inRange(component.inputOpensAt)) {
      entries.push({ type: "ASSESSMENT_OPEN", title: `${component.name} opens`, date: component.inputOpensAt, meta });
    }
    if (component.inputClosesAt && inRange(component.inputClosesAt)) {
      entries.push({ type: "ASSESSMENT_CLOSE", title: `${component.name} closes`, date: component.inputClosesAt, meta });
    }
    if (component.publishAt && inRange(component.publishAt)) {
      entries.push({ type: "ASSESSMENT_PUBLISH", title: `${component.name} publishes`, date: component.publishAt, meta });
    }
  }

  for (const window of windows) {
    const meta = { windowId: window.id, termId: window.termId, classLevelCategory: window.classLevelCategory };
    if (inRange(window.inputOpensAt)) {
      entries.push({ type: "REPORT_WINDOW_OPEN", title: "Report window opens", date: window.inputOpensAt, meta });
    }
    if (inRange(window.inputClosesAt)) {
      entries.push({ type: "REPORT_WINDOW_CLOSE", title: "Report window closes", date: window.inputClosesAt, meta });
    }
  }

  for (const holiday of holidays) {
    if (inRange(holiday.date)) {
      entries.push({ type: "HOLIDAY", title: holiday.name, date: holiday.date, meta: { holidayId: holiday.id } });
    }
  }

  // A multi-day event (e.g. a two-day excursion) overlaps the query range the
  // same way a Term does; a single-day one (no endDate) is a point-in-range
  // check, same as a holiday.
  for (const event of schoolEvents) {
    const end = event.endDate ?? event.date;
    if (event.date <= to && end >= from) {
      entries.push({
        type: "SCHOOL_EVENT",
        title: event.name,
        date: event.date,
        endDate: event.endDate ?? undefined,
        meta: { eventId: event.id },
      });
    }
  }

  // Same overlap check as Term — spans a range rather than a single point.
  // `maxDate` equals `minDate` when every scheduled slot for this component
  // lands on the same day, in which case there's no meaningful range to
  // show, so endDate is omitted (matching the single-day SchoolEvent case).
  for (const schedule of examSchedules) {
    if (schedule.minDate <= to && schedule.maxDate >= from) {
      entries.push({
        type: "EXAM_PERIOD",
        title: schedule.name,
        date: schedule.minDate,
        endDate: schedule.maxDate > schedule.minDate ? schedule.maxDate : undefined,
        meta: { componentId: schedule.componentId },
      });
    }
  }

  return entries.sort((a, b) => a.date.getTime() - b.date.getTime());
}
