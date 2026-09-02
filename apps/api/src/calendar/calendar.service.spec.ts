import { CalendarController, CalendarService } from "./calendar";

function buildPrismaMock() {
  return {
    term: { findMany: jest.fn().mockResolvedValue([]) },
    assessmentComponent: { findMany: jest.fn().mockResolvedValue([]) },
    reportWindow: { findMany: jest.fn().mockResolvedValue([]) },
    schoolHoliday: { findMany: jest.fn().mockResolvedValue([]) },
    schoolEvent: { findMany: jest.fn().mockResolvedValue([]) },
    examSchedule: { groupBy: jest.fn().mockResolvedValue([]) },
  };
}

describe("CalendarService.getEvents", () => {
  it("queries all six source tables with an overlapping-range filter", async () => {
    const prisma = buildPrismaMock();
    const service = new CalendarService(prisma as never);
    const from = new Date("2026-01-01");
    const to = new Date("2026-01-31");

    await service.getEvents(from, to);

    expect(prisma.term.findMany).toHaveBeenCalledWith({
      where: { startDate: { lte: to }, endDate: { gte: from } },
    });
    expect(prisma.assessmentComponent.findMany).toHaveBeenCalled();
    expect(prisma.reportWindow.findMany).toHaveBeenCalled();
    expect(prisma.schoolHoliday.findMany).toHaveBeenCalledWith({ where: { date: { gte: from, lte: to } } });
    expect(prisma.schoolEvent.findMany).toHaveBeenCalled();
    expect(prisma.examSchedule.groupBy).toHaveBeenCalledWith({
      by: ["assessmentComponentId"],
      where: { approvalStatus: "APPROVED" },
      _min: { date: true },
      _max: { date: true },
    });
  });

  it("resolves exam-period component names and folds them into the aggregated entries", async () => {
    const prisma = buildPrismaMock();
    const minDate = new Date("2026-01-10");
    const maxDate = new Date("2026-01-12");
    prisma.examSchedule.groupBy.mockResolvedValue([
      { assessmentComponentId: "comp-1", _min: { date: minDate }, _max: { date: maxDate } },
    ]);
    (prisma as never as { assessmentComponent: { findMany: jest.Mock } }).assessmentComponent = {
      findMany: jest.fn().mockResolvedValue([{ id: "comp-1", name: "Mid-Term Test" }]),
    };
    const service = new CalendarService(prisma as never);
    const from = new Date("2026-01-01");
    const to = new Date("2026-01-31");

    const entries = await service.getEvents(from, to);

    expect(entries).toEqual([
      { type: "EXAM_PERIOD", title: "Mid-Term Test", date: minDate, endDate: maxDate, meta: { componentId: "comp-1" } },
    ]);
  });
});

describe("CalendarController.getEvents — query param validation", () => {
  let controller: CalendarController;
  let service: { getEvents: jest.Mock };

  beforeEach(() => {
    service = { getEvents: jest.fn().mockResolvedValue([]) };
    controller = new CalendarController(service as never);
  });

  it("rejects a request missing from/to", () => {
    expect(() => controller.getEvents(undefined, "2026-01-31")).toThrow(/required/);
    expect(() => controller.getEvents("2026-01-01", undefined)).toThrow(/required/);
  });

  it("rejects an unparseable date", () => {
    expect(() => controller.getEvents("not-a-date", "2026-01-31")).toThrow(/valid dates/);
  });

  it("passes parsed Date objects through to the service", async () => {
    await controller.getEvents("2026-01-01", "2026-01-31");

    expect(service.getEvents).toHaveBeenCalledWith(new Date("2026-01-01"), new Date("2026-01-31"));
  });
});
