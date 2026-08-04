import { SubjectType } from "@prisma/client";
import { SubjectService } from "./subject";
import type { CreateSubjectGroupDto } from "./dto/subject.dto";

function buildTxMock() {
  return {
    subject: { create: jest.fn(), findUniqueOrThrow: jest.fn() },
    subjectGroupWeight: { create: jest.fn() },
  };
}

function buildPrismaMock() {
  return {
    subject: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
  };
}

describe("SubjectService.createGroup (PRD §3.3 — grouped subject, e.g. Basic Science and Technology)", () => {
  let tx: ReturnType<typeof buildTxMock>;
  let prisma: { $transaction: jest.Mock };
  let service: SubjectService;

  beforeEach(() => {
    tx = buildTxMock();
    prisma = { $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)) };
    service = new SubjectService(prisma as never);

    tx.subject.create.mockResolvedValueOnce({ id: "parent-1" }); // parent
    tx.subject.create.mockResolvedValueOnce({ id: "child-1" });
    tx.subject.create.mockResolvedValueOnce({ id: "child-2" });
    tx.subject.findUniqueOrThrow.mockResolvedValue({ id: "parent-1", isGroup: true });
  });

  const dto: CreateSubjectGroupDto = {
    name: "Basic Science and Technology",
    code: "BST",
    type: SubjectType.COMPULSORY,
    children: [
      { name: "Basic Science", code: "BST-BS", weight: 25 },
      { name: "Basic Technology", code: "BST-BT", weight: 25 },
    ],
  };

  it("creates one parent + N children + N weight rows inside a single transaction", async () => {
    await service.createGroup(dto);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.subject.create).toHaveBeenCalledTimes(3); // 1 parent + 2 children
    expect(tx.subject.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ data: expect.objectContaining({ isGroup: true }) }),
    );
    expect(tx.subject.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ data: expect.objectContaining({ parentSubjectId: "parent-1", name: "Basic Science" }) }),
    );
    expect(tx.subjectGroupWeight.create).toHaveBeenCalledTimes(2);
    expect(tx.subjectGroupWeight.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ groupSubjectId: "parent-1", childSubjectId: "child-1", weight: 25 }),
      }),
    );
  });

  it("rejects a departmentId on a non-DEPARTMENT group", async () => {
    await expect(
      service.createGroup({ ...dto, departmentId: "dept-1" }),
    ).rejects.toThrow(/only valid for a DEPARTMENT subject/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("SubjectService.addGroupChild — adding a child to an already-existing group", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let tx: ReturnType<typeof buildTxMock>;
  let service: SubjectService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    tx = buildTxMock();
    prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
    service = new SubjectService(prisma as never);
  });

  it("creates a new child subject + weight row on the existing parent, matching its type/departmentId", async () => {
    prisma.subject.findUniqueOrThrow.mockResolvedValue({
      id: "parent-1",
      isGroup: true,
      type: SubjectType.COMPULSORY,
      departmentId: null,
    });
    tx.subject.create.mockResolvedValue({ id: "child-3" });
    tx.subject.findUniqueOrThrow.mockResolvedValue({ id: "parent-1", isGroup: true });

    await service.addGroupChild("parent-1", { name: "Basic Agriculture", code: "BST-BA", weight: 25 });

    expect(tx.subject.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Basic Agriculture",
          code: "BST-BA",
          type: SubjectType.COMPULSORY,
          parentSubjectId: "parent-1",
        }),
      }),
    );
    expect(tx.subjectGroupWeight.create).toHaveBeenCalledWith({
      data: { groupSubjectId: "parent-1", childSubjectId: "child-3", weight: 25 },
    });
  });

  it("rejects adding a child to a subject that isn't a group", async () => {
    prisma.subject.findUniqueOrThrow.mockResolvedValue({ id: "subj-1", isGroup: false });

    await expect(
      service.addGroupChild("subj-1", { name: "X", code: "X", weight: 10 }),
    ).rejects.toThrow(/Only a grouped subject can have child subjects added to it/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("SubjectService.setActive — catalogue-wide disable/enable", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: SubjectService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new SubjectService(prisma as never);
  });

  it("disables a subject", async () => {
    await service.setActive("subj-1", false);
    expect(prisma.subject.update).toHaveBeenCalledWith({ where: { id: "subj-1" }, data: { isActive: false } });
  });

  it("re-enables a subject", async () => {
    await service.setActive("subj-1", true);
    expect(prisma.subject.update).toHaveBeenCalledWith({ where: { id: "subj-1" }, data: { isActive: true } });
  });
});
