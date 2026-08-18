import { CalendarController, CalendarService } from "./calendar";

function buildPrismaMock() {
  return {
    term: { findMany: jest.fn().mockResolvedValue([]) },
    assessmentComponent: { findMany: jest.fn().mockResolvedValue([]) },
    reportWindow: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

describe("CalendarService.getEvents", () => {
  it("queries all three source tables with an overlapping-range filter", async () => {
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
