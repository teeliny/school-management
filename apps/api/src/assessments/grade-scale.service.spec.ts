import { GradeScaleService } from "./grade-scale";

function buildPrismaMock() {
  return {
    gradeScale: { create: jest.fn(), findMany: jest.fn(), update: jest.fn(), delete: jest.fn() },
  };
}

describe("GradeScaleService", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: GradeScaleService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new GradeScaleService(prisma as never);
  });

  it("creates a grade scale row from the dto as-is", async () => {
    const dto = { minScore: 70, maxScore: 100, grade: "A1", remark: "Excellent" };
    prisma.gradeScale.create.mockResolvedValue({ id: "scale-1", ...dto });

    await service.create(dto);

    expect(prisma.gradeScale.create).toHaveBeenCalledWith({ data: dto });
  });

  it("lists grade scales ordered from highest to lowest minScore", async () => {
    prisma.gradeScale.findMany.mockResolvedValue([]);

    await service.findAll();

    expect(prisma.gradeScale.findMany).toHaveBeenCalledWith({ orderBy: { minScore: "desc" } });
  });
});
