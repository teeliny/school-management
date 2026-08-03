import { SkillCategory } from "@prisma/client";
import { SkillAssessmentItemService } from "./skill-assessment-item";

function buildPrismaMock() {
  return {
    skillAssessmentItem: { findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    academicSession: { findMany: jest.fn() },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
}

describe("SkillAssessmentItemService.findAllForSession (PRD FR4.5 — session copy-forward)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: SkillAssessmentItemService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new SkillAssessmentItemService(prisma as never);
  });

  it("returns the session's own items without copying when it already has some", async () => {
    prisma.skillAssessmentItem.findMany.mockResolvedValue([{ id: "item-1" }]);

    const result = await service.findAllForSession("session-2");

    expect(result).toEqual([{ id: "item-1" }]);
    expect(prisma.academicSession.findMany).not.toHaveBeenCalled();
  });

  it("copies the most recent prior session's items when this session has none", async () => {
    prisma.skillAssessmentItem.findMany
      .mockResolvedValueOnce([]) // current session — empty
      .mockResolvedValueOnce([
        { category: SkillCategory.PSYCHOMOTOR, name: "Handwriting", order: 1, isActive: true },
      ]); // prior session's items
    prisma.academicSession.findMany.mockResolvedValue([{ id: "session-1" }]);
    prisma.skillAssessmentItem.create.mockImplementation((args) => Promise.resolve({ id: "new-item", ...args.data }));

    const result = await service.findAllForSession("session-2");

    expect(prisma.skillAssessmentItem.create).toHaveBeenCalledWith({
      data: {
        academicSessionId: "session-2",
        category: SkillCategory.PSYCHOMOTOR,
        name: "Handwriting",
        order: 1,
        isActive: true,
      },
    });
    expect(result).toEqual([
      expect.objectContaining({ academicSessionId: "session-2", name: "Handwriting" }),
    ]);
  });

  it("skips a prior session with no items and keeps looking further back", async () => {
    prisma.skillAssessmentItem.findMany
      .mockResolvedValueOnce([]) // current session
      .mockResolvedValueOnce([]) // most recent prior session — also empty
      .mockResolvedValueOnce([
        { category: SkillCategory.AFFECTIVE_COGNITIVE, name: "Punctuality", order: 1, isActive: true },
      ]); // two sessions back
    prisma.academicSession.findMany.mockResolvedValue([{ id: "session-2" }, { id: "session-1" }]);
    prisma.skillAssessmentItem.create.mockImplementation((args) => Promise.resolve({ id: "new-item", ...args.data }));

    await service.findAllForSession("session-3");

    expect(prisma.skillAssessmentItem.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: "Punctuality" }) }),
    );
  });

  it("returns an empty list when no prior session has any items either (first-ever session)", async () => {
    prisma.skillAssessmentItem.findMany.mockResolvedValue([]);
    prisma.academicSession.findMany.mockResolvedValue([]);

    const result = await service.findAllForSession("session-1");

    expect(result).toEqual([]);
    expect(prisma.skillAssessmentItem.create).not.toHaveBeenCalled();
  });
});
