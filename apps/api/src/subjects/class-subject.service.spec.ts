import { SubjectType } from "@prisma/client";
import { ClassSubjectService } from "./class-subject";

function buildPrismaMock() {
  return {
    classSubject: { create: jest.fn(), update: jest.fn() },
  };
}

describe("ClassSubjectService.create", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: ClassSubjectService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new ClassSubjectService(prisma as never);
  });

  it("rejects a DEPARTMENT assignment with no departmentId", () => {
    expect(() =>
      service.create({ classLevelCategory: "SSS", subjectId: "subj-1", type: SubjectType.DEPARTMENT } as never),
    ).toThrow(/departmentId is required/);
    expect(prisma.classSubject.create).not.toHaveBeenCalled();
  });

  it("rejects a non-DEPARTMENT assignment with a departmentId", () => {
    expect(() =>
      service.create({
        classLevelCategory: "JSS",
        subjectId: "subj-1",
        type: SubjectType.GENERAL,
        departmentId: "dept-1",
      } as never),
    ).toThrow(/departmentId is only valid/);
    expect(prisma.classSubject.create).not.toHaveBeenCalled();
  });
});

describe("ClassSubjectService.update", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: ClassSubjectService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new ClassSubjectService(prisma as never);
  });

  it("clears a stale departmentId when type moves off DEPARTMENT without an explicit departmentId", async () => {
    // Regression: JSON.stringify drops `undefined` keys, so a client
    // switching type away from DEPARTMENT typically omits departmentId
    // entirely rather than sending null — a naive `data: dto` partial
    // update would then leave the previous department stale on the row.
    await service.update("cs-1", { type: SubjectType.GENERAL } as never);

    expect(prisma.classSubject.update).toHaveBeenCalledWith({
      where: { id: "cs-1" },
      data: { type: SubjectType.GENERAL, departmentId: null },
    });
  });

  it("keeps the given departmentId when type is DEPARTMENT", async () => {
    await service.update("cs-1", { type: SubjectType.DEPARTMENT, departmentId: "dept-1" } as never);

    expect(prisma.classSubject.update).toHaveBeenCalledWith({
      where: { id: "cs-1" },
      data: { type: SubjectType.DEPARTMENT, departmentId: "dept-1" },
    });
  });

  it("rejects moving to DEPARTMENT without a departmentId", () => {
    expect(() => service.update("cs-1", { type: SubjectType.DEPARTMENT } as never)).toThrow(
      /departmentId is required/,
    );
    expect(prisma.classSubject.update).not.toHaveBeenCalled();
  });

  it("passes non-type updates straight through", async () => {
    await service.update("cs-1", {} as never);

    expect(prisma.classSubject.update).toHaveBeenCalledWith({ where: { id: "cs-1" }, data: {} });
  });
});
