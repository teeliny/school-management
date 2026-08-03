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
  classLevelId: string;
  inputOpensAt: Date;
  inputClosesAt: Date;
  publishAt: Date;
}

export interface CalendarWindowInput {
  id: string;
  termId: string;
  classLevelId: string;
  inputOpensAt: Date;
  inputClosesAt: Date;
}

export interface CalendarEntry {
  type: "TERM" | "ASSESSMENT_OPEN" | "ASSESSMENT_CLOSE" | "ASSESSMENT_PUBLISH" | "REPORT_WINDOW_OPEN" | "REPORT_WINDOW_CLOSE";
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
    const meta = { componentId: component.id, termId: component.termId, classLevelId: component.classLevelId };
    if (inRange(component.inputOpensAt)) {
      entries.push({ type: "ASSESSMENT_OPEN", title: `${component.name} opens`, date: component.inputOpensAt, meta });
    }
    if (inRange(component.inputClosesAt)) {
      entries.push({ type: "ASSESSMENT_CLOSE", title: `${component.name} closes`, date: component.inputClosesAt, meta });
    }
    if (inRange(component.publishAt)) {
      entries.push({ type: "ASSESSMENT_PUBLISH", title: `${component.name} publishes`, date: component.publishAt, meta });
    }
  }

  for (const window of windows) {
    const meta = { windowId: window.id, termId: window.termId, classLevelId: window.classLevelId };
    if (inRange(window.inputOpensAt)) {
      entries.push({ type: "REPORT_WINDOW_OPEN", title: "Report window opens", date: window.inputOpensAt, meta });
    }
    if (inRange(window.inputClosesAt)) {
      entries.push({ type: "REPORT_WINDOW_CLOSE", title: "Report window closes", date: window.inputClosesAt, meta });
    }
  }

  return entries.sort((a, b) => a.date.getTime() - b.date.getTime());
}
