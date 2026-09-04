import { SkillGroupValueType } from "@prisma/client";
import { SkillAssessmentItemService } from "./skill-assessment-item";

function buildPrismaMock() {
  return {
    skillAssessmentItem: { count: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    skillGroup: { upsert: jest.fn() },
    academicSession: { findMany: jest.fn() },
    $transaction: jest.fn((arg: unknown[]) => Promise.all(arg)),
  };
}

let prisma: ReturnType<typeof buildPrismaMock>;

describe("SkillAssessmentItemService.findAllForSession (PRD FR4.5 — session copy-forward)", () => {
  let service: SkillAssessmentItemService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new SkillAssessmentItemService(prisma as never);
  });

  it("returns the session's own items without copying when it already has some", async () => {
    prisma.skillAssessmentItem.count.mockResolvedValue(1);
    prisma.skillAssessmentItem.findMany.mockResolvedValue([{ id: "item-1" }]);

    const result = await service.findAllForSession("session-2");

    expect(result).toEqual([{ id: "item-1" }]);
    expect(prisma.academicSession.findMany).not.toHaveBeenCalled();
  });

  it("copies the most recent prior session's items, finding-or-creating an equivalent group by name, when this session has none", async () => {
    prisma.skillAssessmentItem.count.mockResolvedValue(0);
    prisma.academicSession.findMany.mockResolvedValue([{ id: "session-1" }]);
    prisma.skillAssessmentItem.findMany
      .mockResolvedValueOnce([
        {
          name: "Handwriting",
          order: 1,
          isActive: true,
          group: {
            name: "Psychomotor Skills",
            order: 1,
            valueType: SkillGroupValueType.RATING,
            isActive: true,
            classLevelCategories: [],
          },
        },
      ]) // prior session's items
      .mockResolvedValueOnce([{ id: "new-item" }]); // final re-query of the now-populated current session
    prisma.skillGroup.upsert.mockResolvedValue({ id: "group-2" });
    prisma.skillAssessmentItem.create.mockImplementation((args: { data: unknown }) => Promise.resolve({ id: "new-item", ...args.data }));

    await service.findAllForSession("session-2");

    expect(prisma.skillGroup.upsert).toHaveBeenCalledWith({
      where: { academicSessionId_name: { academicSessionId: "session-2", name: "Psychomotor Skills" } },
      update: {},
      create: {
        academicSessionId: "session-2",
        name: "Psychomotor Skills",
        order: 1,
        valueType: SkillGroupValueType.RATING,
        isActive: true,
        classLevelCategories: { create: [] },
      },
    });
    expect(prisma.skillAssessmentItem.create).toHaveBeenCalledWith({
      data: { academicSessionId: "session-2", groupId: "group-2", name: "Handwriting", order: 1, isActive: true },
    });
  });

  it("dedupes group creation when several copied items share one group", async () => {
    prisma.skillAssessmentItem.count.mockResolvedValue(0);
    prisma.academicSession.findMany.mockResolvedValue([{ id: "session-1" }]);
    const group = { name: "Affective/Cognitive Skills", order: 2, valueType: SkillGroupValueType.RATING, isActive: true, classLevelCategories: [] };
    prisma.skillAssessmentItem.findMany
      .mockResolvedValueOnce([
        { name: "Punctuality", order: 1, isActive: true, group },
        { name: "Neatness", order: 2, isActive: true, group },
      ])
      .mockResolvedValueOnce([]);
    prisma.skillGroup.upsert.mockResolvedValue({ id: "group-2" });
    prisma.skillAssessmentItem.create.mockResolvedValue({ id: "new-item" });

    await service.findAllForSession("session-2");

    expect(prisma.skillGroup.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.skillAssessmentItem.create).toHaveBeenCalledTimes(2);
  });

  it("skips a prior session with no items and keeps looking further back", async () => {
    prisma.skillAssessmentItem.count.mockResolvedValue(0);
    prisma.academicSession.findMany.mockResolvedValue([{ id: "session-2" }, { id: "session-1" }]);
    prisma.skillAssessmentItem.findMany
      .mockResolvedValueOnce([]) // most recent prior session — empty
      .mockResolvedValueOnce([
        {
          name: "Relationship with Others",
          order: 1,
          isActive: true,
          group: { name: "Affective/Cognitive Skills", order: 2, valueType: SkillGroupValueType.RATING, isActive: true, classLevelCategories: [] },
        },
      ]) // two sessions back
      .mockResolvedValueOnce([]); // final re-query
    prisma.skillGroup.upsert.mockResolvedValue({ id: "group-3" });
    prisma.skillAssessmentItem.create.mockResolvedValue({ id: "new-item" });

    await service.findAllForSession("session-3");

    expect(prisma.skillAssessmentItem.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: "Relationship with Others" }) }),
    );
  });

  it("returns an empty list when no prior session has any items either (first-ever session)", async () => {
    prisma.skillAssessmentItem.count.mockResolvedValue(0);
    prisma.academicSession.findMany.mockResolvedValue([]);
    prisma.skillAssessmentItem.findMany.mockResolvedValue([]);

    const result = await service.findAllForSession("session-1");

    expect(result).toEqual([]);
    expect(prisma.skillAssessmentItem.create).not.toHaveBeenCalled();
  });

  it("filters to items whose group is applicable to a given classLevelCategory (unrestricted or explicitly matching)", async () => {
    prisma.skillAssessmentItem.count.mockResolvedValue(2);
    prisma.skillAssessmentItem.findMany.mockResolvedValue([{ id: "item-1" }]);

    await service.findAllForSession("session-2", "RECEPTION" as never);

    expect(prisma.skillAssessmentItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          academicSessionId: "session-2",
          group: { OR: [{ classLevelCategories: { none: {} } }, { classLevelCategories: { some: { classLevelCategory: "RECEPTION" } } }] },
        },
      }),
    );
  });
});

describe("SkillAssessmentItemService.create/update — plain field writes now that classLevelCategories lives on the group", () => {
  let service: SkillAssessmentItemService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new SkillAssessmentItemService(prisma as never);
  });

  it("create() passes groupId straight through", async () => {
    prisma.skillAssessmentItem.create.mockResolvedValue({ id: "item-1" });

    await service.create({ academicSessionId: "session-1", groupId: "group-1", name: "Counting", order: 1 });

    expect(prisma.skillAssessmentItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { academicSessionId: "session-1", groupId: "group-1", name: "Counting", order: 1, isActive: undefined },
      }),
    );
  });

  it("update() is a plain field update, including moving an item to a different group", async () => {
    prisma.skillAssessmentItem.update.mockResolvedValue({ id: "item-1" });

    await service.update("item-1", { groupId: "group-2", name: "Renamed" });

    expect(prisma.skillAssessmentItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "item-1" }, data: { groupId: "group-2", name: "Renamed" } }),
    );
  });
});
