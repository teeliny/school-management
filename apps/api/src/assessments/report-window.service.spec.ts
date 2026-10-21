import { ReportWindowStatus } from "@prisma/client";
import { ReportWindowService } from "./report-window";

function buildPrismaMock() {
  return {
    reportWindow: {
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
    term: { findUniqueOrThrow: jest.fn() },
  };
}

describe("ReportWindowService", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: ReportWindowService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new ReportWindowService(prisma as never);
  });

  it("stamps createdByUserId from the acting user on create", async () => {
    const dto = { termId: "term-1", classLevelId: "level-1", inputOpensAt: new Date(), inputClosesAt: new Date() };
    prisma.reportWindow.create.mockResolvedValue({ id: "window-1" });

    await service.create(dto, "user-1");

    expect(prisma.reportWindow.create).toHaveBeenCalledWith({ data: { ...dto, createdByUserId: "user-1" } });
  });

  it("forceOpen sets status to OPEN regardless of schedule", async () => {
    prisma.reportWindow.update.mockResolvedValue({ id: "window-1", status: ReportWindowStatus.OPEN });

    await service.forceOpen("window-1");

    expect(prisma.reportWindow.update).toHaveBeenCalledWith({
      where: { id: "window-1" },
      data: { status: ReportWindowStatus.OPEN },
    });
  });

  it("forceClose sets status to CLOSED regardless of schedule", async () => {
    prisma.reportWindow.update.mockResolvedValue({ id: "window-1", status: ReportWindowStatus.CLOSED });

    await service.forceClose("window-1");

    expect(prisma.reportWindow.update).toHaveBeenCalledWith({
      where: { id: "window-1" },
      data: { status: ReportWindowStatus.CLOSED },
    });
  });

  describe("ensure", () => {
    it("returns an existing window untouched, whatever its status", async () => {
      const existing = { id: "window-1", status: ReportWindowStatus.CLOSED };
      prisma.reportWindow.findUnique.mockResolvedValue(existing);

      await expect(service.ensure("term-1", "JSS", "user-1")).resolves.toBe(existing);
      expect(prisma.reportWindow.upsert).not.toHaveBeenCalled();
    });

    it("creates an OPEN window from now until the term's end date", async () => {
      const termEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      prisma.reportWindow.findUnique.mockResolvedValue(null);
      prisma.term.findUniqueOrThrow.mockResolvedValue({ id: "term-1", endDate: termEnd });

      await service.ensure("term-1", "JSS", "user-1");

      const { create } = prisma.reportWindow.upsert.mock.calls[0][0];
      expect(create).toMatchObject({
        termId: "term-1",
        classLevelCategory: "JSS",
        status: ReportWindowStatus.OPEN,
        inputClosesAt: termEnd,
        createdByUserId: "user-1",
      });
      expect(create.inputOpensAt.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it("keeps the window open for 14 days when the term has already ended", async () => {
      prisma.reportWindow.findUnique.mockResolvedValue(null);
      prisma.term.findUniqueOrThrow.mockResolvedValue({ id: "term-1", endDate: new Date("2020-01-01") });

      await service.ensure("term-1", "JSS", "user-1");

      const { create } = prisma.reportWindow.upsert.mock.calls[0][0];
      const days = (create.inputClosesAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      expect(days).toBeGreaterThan(13.9);
      expect(days).toBeLessThanOrEqual(14);
    });
  });
});
