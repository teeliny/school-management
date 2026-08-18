import { computeAttendancePercentage, computeSchoolDaysOpened } from "@school/types";

// Mon 2026-03-02 .. Fri 2026-03-06
const MONDAY = new Date("2026-03-02T00:00:00.000Z");
const WEDNESDAY = new Date("2026-03-04T00:00:00.000Z");
const FRIDAY = new Date("2026-03-06T00:00:00.000Z");
const SATURDAY = new Date("2026-03-07T00:00:00.000Z");
const SUNDAY = new Date("2026-03-08T00:00:00.000Z");

describe("computeSchoolDaysOpened (PRD §3.7)", () => {
  it("counts every weekday in a full Mon-Fri week with no holidays", () => {
    expect(computeSchoolDaysOpened({ start: MONDAY, end: FRIDAY }, [], "DAILY")).toBe(5);
  });

  it("subtracts a holiday that falls mid-week", () => {
    expect(computeSchoolDaysOpened({ start: MONDAY, end: FRIDAY }, [WEDNESDAY], "DAILY")).toBe(4);
  });

  it("counts zero opened days for a weekend-only range", () => {
    expect(computeSchoolDaysOpened({ start: SATURDAY, end: SUNDAY }, [], "DAILY")).toBe(0);
  });

  it("doubles the count under MORNING_AND_AFTERNOON granularity", () => {
    expect(computeSchoolDaysOpened({ start: MONDAY, end: FRIDAY }, [], "MORNING_AND_AFTERNOON")).toBe(10);
  });

  it("includes both the start and end date of the range", () => {
    expect(computeSchoolDaysOpened({ start: MONDAY, end: MONDAY }, [], "DAILY")).toBe(1);
  });

  it("ignores a holiday date outside the range", () => {
    expect(computeSchoolDaysOpened({ start: MONDAY, end: FRIDAY }, [SUNDAY], "DAILY")).toBe(5);
  });
});

describe("computeAttendancePercentage", () => {
  it("computes a rounded percentage to one decimal place", () => {
    expect(computeAttendancePercentage(1, 3)).toBe(33.3);
  });

  it("returns 100 when present equals opened", () => {
    expect(computeAttendancePercentage(8, 8)).toBe(100);
  });

  it("returns 0 when present is zero but days opened", () => {
    expect(computeAttendancePercentage(0, 5)).toBe(0);
  });

  it("returns null when no school days opened, avoiding a divide-by-zero", () => {
    expect(computeAttendancePercentage(0, 0)).toBeNull();
  });
});
