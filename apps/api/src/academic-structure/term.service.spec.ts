import { AssessmentComponentStatus, AssessmentComponentType } from "@prisma/client";
import { TermService } from "./term";
import type { CreateTermDto } from "./dto/term.dto";

function buildTxMock() {
  return {
    term: { create: jest.fn(), findFirst: jest.fn() },
    assessmentComponent: { findMany: jest.fn(), createMany: jest.fn() },
  };
}

const dto: CreateTermDto = {
  academicSessionId: "session-1",
  name: "First Term",
  startDate: new Date("2027-01-08"),
  endDate: new Date("2027-04-02"),
};

describe("TermService.create — carrying AssessmentComponent structure forward", () => {
  let tx: ReturnType<typeof buildTxMock>;
  let prisma: { $transaction: jest.Mock };
  let service: TermService;

  beforeEach(() => {
    tx = buildTxMock();
    prisma = { $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)) };
    service = new TermService(prisma as never);
    tx.term.create.mockResolvedValue({ id: "term-new", ...dto });
  });

  it("copies the chronologically-preceding term's AssessmentComponent structure, resetting status and dropping dates", async () => {
    tx.term.findFirst.mockResolvedValue({ id: "term-prev", startDate: new Date("2026-09-01") });
    tx.assessmentComponent.findMany.mockResolvedValue([
      {
        classLevelCategory: "JSS",
        type: AssessmentComponentType.CA,
        name: "1st CA",
        sequence: 1,
        maxScore: 20,
        status: AssessmentComponentStatus.PUBLISHED,
        inputOpensAt: new Date("2026-09-15"),
        inputClosesAt: new Date("2026-09-30"),
        publishAt: new Date("2026-10-05"),
        createdByUserId: "user-1",
      },
    ]);

    await service.create(dto);

    expect(tx.assessmentComponent.createMany).toHaveBeenCalledWith({
      data: [
        {
          termId: "term-new",
          classLevelCategory: "JSS",
          type: AssessmentComponentType.CA,
          name: "1st CA",
          sequence: 1,
          maxScore: 20,
          status: AssessmentComponentStatus.DRAFT,
          createdByUserId: "user-1",
        },
      ],
      skipDuplicates: true,
    });
  });

  it("does nothing when there is no preceding term (first term ever)", async () => {
    tx.term.findFirst.mockResolvedValue(null);

    await service.create(dto);

    expect(tx.assessmentComponent.findMany).not.toHaveBeenCalled();
    expect(tx.assessmentComponent.createMany).not.toHaveBeenCalled();
  });

  it("does nothing when the preceding term had no assessment components", async () => {
    tx.term.findFirst.mockResolvedValue({ id: "term-prev", startDate: new Date("2026-09-01") });
    tx.assessmentComponent.findMany.mockResolvedValue([]);

    await service.create(dto);

    expect(tx.assessmentComponent.createMany).not.toHaveBeenCalled();
  });
});
