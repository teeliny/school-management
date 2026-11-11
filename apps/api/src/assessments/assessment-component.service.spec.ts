import { AssessmentComponentStatus } from "@prisma/client";
import { AssessmentComponentService } from "./assessment-component";

function buildPrismaMock() {
  return {
    assessmentComponent: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      delete: jest.fn(),
    },
    term: { findUniqueOrThrow: jest.fn() },
    termReportCard: { updateMany: jest.fn() },
  };
}

describe("AssessmentComponentService.assertStructureComplete (PRD §3.6)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: AssessmentComponentService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new AssessmentComponentService(prisma as never);
  });

  it("passes when the term/class level's components sum to exactly 100", async () => {
    prisma.assessmentComponent.findMany.mockResolvedValue([
      { maxScore: 20 },
      { maxScore: 20 },
      { maxScore: 60 },
    ]);

    await expect(service.assertStructureComplete("term-1", "level-1")).resolves.toBeUndefined();
  });

  it("rejects when the components sum to less than 100 (incomplete structure)", async () => {
    prisma.assessmentComponent.findMany.mockResolvedValue([{ maxScore: 20 }, { maxScore: 60 }]);

    await expect(service.assertStructureComplete("term-1", "level-1")).rejects.toThrow(/sum to 80/);
  });

  it("rejects when the components sum to more than 100", async () => {
    prisma.assessmentComponent.findMany.mockResolvedValue([{ maxScore: 60 }, { maxScore: 60 }]);

    await expect(service.assertStructureComplete("term-1", "level-1")).rejects.toThrow(/not 100/);
  });
});

describe("AssessmentComponentService.forceOpen (Admin override)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: AssessmentComponentService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new AssessmentComponentService(prisma as never);
  });

  it("opens the component when the structure is complete", async () => {
    prisma.assessmentComponent.findUniqueOrThrow.mockResolvedValue({
      id: "comp-1",
      termId: "term-1",
      classLevelId: "level-1",
    });
    prisma.assessmentComponent.findMany.mockResolvedValue([
      { maxScore: 20 },
      { maxScore: 20 },
      { maxScore: 60 },
    ]);
    prisma.assessmentComponent.update.mockResolvedValue({ id: "comp-1", status: AssessmentComponentStatus.OPEN });

    const result = await service.forceOpen("comp-1");

    expect(result.status).toBe(AssessmentComponentStatus.OPEN);
    expect(prisma.assessmentComponent.update).toHaveBeenCalledWith({
      where: { id: "comp-1" },
      data: { status: AssessmentComponentStatus.OPEN },
    });
  });

  it("refuses to open the component when the structure is incomplete", async () => {
    prisma.assessmentComponent.findUniqueOrThrow.mockResolvedValue({
      id: "comp-1",
      termId: "term-1",
      classLevelId: "level-1",
    });
    prisma.assessmentComponent.findMany.mockResolvedValue([{ maxScore: 20 }]);

    await expect(service.forceOpen("comp-1")).rejects.toThrow(/sum to 20/);
    expect(prisma.assessmentComponent.update).not.toHaveBeenCalled();
  });
});

describe("AssessmentComponentService.forcePublish (Admin override)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: AssessmentComponentService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new AssessmentComponentService(prisma as never);
  });

  it("publishes the class group's READY mid-term report cards when the MID_TERM component is force-published", async () => {
    const endDate = new Date("2025-12-18");
    prisma.assessmentComponent.update.mockResolvedValue({
      id: "comp-1",
      type: "MID_TERM",
      termId: "term-1",
      classLevelCategory: "SSS",
      status: AssessmentComponentStatus.PUBLISHED,
    });
    prisma.term.findUniqueOrThrow.mockResolvedValue({ id: "term-1", endDate });

    await service.forcePublish("comp-1");

    expect(prisma.termReportCard.updateMany).toHaveBeenCalledWith({
      where: {
        termId: "term-1",
        reportType: "MID_TERM",
        status: "READY",
        needsRegeneration: false,
        student: {
          currentClass: { classLevel: { category: "SSS" } },
          OR: [{ status: "ACTIVE" }, { inactiveSince: { gte: endDate } }],
        },
      },
      data: { status: "PUBLISHED", publishedAt: expect.any(Date) },
    });
  });

  it("leaves report cards alone when a non-MID_TERM component is force-published", async () => {
    prisma.assessmentComponent.update.mockResolvedValue({ id: "comp-2", type: "EXAM", termId: "term-1" });

    await service.forcePublish("comp-2");

    expect(prisma.termReportCard.updateMany).not.toHaveBeenCalled();
  });
});
