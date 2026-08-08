import { AttendanceAnalyticsService } from "./attendance-analytics";

// Mon 2026-03-02 .. Fri 2026-03-06 — 5 weekdays, no holidays.
const TERM = { id: "term-1", startDate: new Date("2026-03-02T00:00:00.000Z"), endDate: new Date("2026-03-06T00:00:00.000Z") };

function buildPrismaMock() {
  return {
    term: { findUniqueOrThrow: jest.fn().mockResolvedValue(TERM) },
    schoolHoliday: { findMany: jest.fn().mockResolvedValue([]) },
    attendanceRecord: { findMany: jest.fn().mockResolvedValue([]) },
    studentProfile: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

function buildSchoolProfileMock() {
  return { get: jest.fn().mockResolvedValue({ attendanceGranularity: "DAILY" }) };
}

describe("AttendanceAnalyticsService (PRD §6.5 FR5.3)", () => {
  it("computes a student's present/absent counts and percentage against school days opened", async () => {
    const prisma = buildPrismaMock();
    prisma.attendanceRecord.findMany.mockResolvedValue([
      { status: "PRESENT" },
      { status: "PRESENT" },
      { status: "PRESENT" },
      { status: "PRESENT" },
      { status: "ABSENT" },
    ]);
    const service = new AttendanceAnalyticsService(prisma as never, buildSchoolProfileMock() as never);

    const result = await service.forStudent("student-1", "term-1");

    expect(result).toMatchObject({ schoolDaysOpened: 5, present: 4, absent: 1, late: 0, excused: 0, percentage: 80 });
  });

  it("doubles school days opened under MORNING_AND_AFTERNOON granularity", async () => {
    const prisma = buildPrismaMock();
    const schoolProfile = { get: jest.fn().mockResolvedValue({ attendanceGranularity: "MORNING_AND_AFTERNOON" }) };
    const service = new AttendanceAnalyticsService(prisma as never, schoolProfile as never);

    const result = await service.forStudent("student-1", "term-1");

    expect(result.schoolDaysOpened).toBe(10);
  });

  it("returns null percentage when no school days are opened in the range", async () => {
    const prisma = buildPrismaMock();
    prisma.term.findUniqueOrThrow.mockResolvedValue({
      id: "term-1",
      startDate: new Date("2026-03-07T00:00:00.000Z"),
      endDate: new Date("2026-03-08T00:00:00.000Z"),
    });
    const service = new AttendanceAnalyticsService(prisma as never, buildSchoolProfileMock() as never);

    const result = await service.forStudent("student-1", "term-1");

    expect(result.schoolDaysOpened).toBe(0);
    expect(result.percentage).toBeNull();
  });

  it("builds a per-student breakdown plus class average for a class arm", async () => {
    const prisma = buildPrismaMock();
    prisma.studentProfile.findMany.mockResolvedValue([
      { id: "student-1", admissionNumber: "A1", user: { firstName: "Ada", lastName: "Bello" } },
      { id: "student-2", admissionNumber: "A2", user: { firstName: "Chidi", lastName: "Okafor" } },
    ]);
    prisma.attendanceRecord.findMany.mockResolvedValue([
      { personId: "student-1", status: "PRESENT" },
      { personId: "student-1", status: "PRESENT" },
      { personId: "student-1", status: "PRESENT" },
      { personId: "student-1", status: "PRESENT" },
      { personId: "student-1", status: "PRESENT" },
      { personId: "student-2", status: "ABSENT" },
    ]);
    const service = new AttendanceAnalyticsService(prisma as never, buildSchoolProfileMock() as never);

    const result = await service.forClassArm("arm-1", "term-1");

    expect(result.students).toHaveLength(2);
    expect(result.students[0]).toMatchObject({ studentId: "student-1", present: 5, percentage: 100 });
    expect(result.students[1]).toMatchObject({ studentId: "student-2", present: 0, absent: 1, percentage: 0 });
    // 5 present out of a possible 2 students * 5 opened days = 10.
    expect(result.classAveragePercentage).toBe(50);
  });

  it("computes a staff member's own attendance against school days opened", async () => {
    const prisma = buildPrismaMock();
    prisma.attendanceRecord.findMany.mockResolvedValue([{ status: "PRESENT" }, { status: "LATE" }]);
    const service = new AttendanceAnalyticsService(prisma as never, buildSchoolProfileMock() as never);

    const result = await service.forStaff("staff-1", "term-1");

    expect(result).toMatchObject({ schoolDaysOpened: 5, present: 1, late: 1, percentage: 20 });
  });
});
