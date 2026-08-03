import { buildCalendarEntries } from "./calendar.util";

const FROM = new Date("2026-01-01T00:00:00Z");
const TO = new Date("2026-01-31T23:59:59Z");
const IN_RANGE = new Date("2026-01-15T00:00:00Z");
const BEFORE_RANGE = new Date("2025-12-01T00:00:00Z");
const AFTER_RANGE = new Date("2026-03-01T00:00:00Z");

describe("buildCalendarEntries (PRD §3.11 read-aggregation)", () => {
  it("includes a Term whose date range overlaps the query range", () => {
    const entries = buildCalendarEntries(
      [{ id: "term-1", name: "First Term", startDate: BEFORE_RANGE, endDate: IN_RANGE }],
      [],
      [],
      FROM,
      TO,
    );

    expect(entries).toEqual([
      { type: "TERM", title: "First Term", date: BEFORE_RANGE, endDate: IN_RANGE, meta: { termId: "term-1" } },
    ]);
  });

  it("excludes a Term entirely outside the query range", () => {
    const entries = buildCalendarEntries(
      [{ id: "term-1", name: "Next Term", startDate: AFTER_RANGE, endDate: AFTER_RANGE }],
      [],
      [],
      FROM,
      TO,
    );

    expect(entries).toEqual([]);
  });

  it("emits one entry per AssessmentComponent date field that falls in range, and skips the ones that don't", () => {
    const entries = buildCalendarEntries(
      [],
      [
        {
          id: "comp-1",
          name: "1st CA",
          termId: "term-1",
          classLevelId: "level-1",
          inputOpensAt: IN_RANGE,
          inputClosesAt: AFTER_RANGE,
          publishAt: AFTER_RANGE,
        },
      ],
      [],
      FROM,
      TO,
    );

    expect(entries).toEqual([
      {
        type: "ASSESSMENT_OPEN",
        title: "1st CA opens",
        date: IN_RANGE,
        meta: { componentId: "comp-1", termId: "term-1", classLevelId: "level-1" },
      },
    ]);
  });

  it("emits one entry per ReportWindow date field that falls in range", () => {
    const entries = buildCalendarEntries(
      [],
      [],
      [
        {
          id: "window-1",
          termId: "term-1",
          classLevelId: "level-1",
          inputOpensAt: IN_RANGE,
          inputClosesAt: AFTER_RANGE,
        },
      ],
      FROM,
      TO,
    );

    expect(entries).toEqual([
      {
        type: "REPORT_WINDOW_OPEN",
        title: "Report window opens",
        date: IN_RANGE,
        meta: { windowId: "window-1", termId: "term-1", classLevelId: "level-1" },
      },
    ]);
  });

  it("sorts all entries chronologically regardless of source table", () => {
    const earlier = new Date("2026-01-05T00:00:00Z");
    const later = new Date("2026-01-25T00:00:00Z");

    const entries = buildCalendarEntries(
      [],
      [
        {
          id: "comp-1",
          name: "Exam",
          termId: "term-1",
          classLevelId: "level-1",
          inputOpensAt: later,
          inputClosesAt: later,
          publishAt: later,
        },
      ],
      [{ id: "window-1", termId: "term-1", classLevelId: "level-1", inputOpensAt: earlier, inputClosesAt: earlier }],
      FROM,
      TO,
    );

    expect(entries.map((e) => e.type)).toEqual([
      "REPORT_WINDOW_OPEN",
      "REPORT_WINDOW_CLOSE",
      "ASSESSMENT_OPEN",
      "ASSESSMENT_CLOSE",
      "ASSESSMENT_PUBLISH",
    ]);
  });
});
