import { ReportWindowStatus } from "@prisma/client";
import { ReportWindowService } from "./report-window";

function buildPrismaMock() {
  return {
    reportWindow: {
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      delete: jest.fn(),
    },
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
});
