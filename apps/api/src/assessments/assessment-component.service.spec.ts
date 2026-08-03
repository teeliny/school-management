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
