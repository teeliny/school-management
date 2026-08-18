import { SubjectType } from "@prisma/client";
import { ClassSubjectService } from "./class-subject";

function buildPrismaMock() {
  return {
    classSubject: {
      create: jest.fn().mockResolvedValue({ id: "cs-1" }),
      update: jest.fn().mockResolvedValue({ id: "cs-1" }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: "cs-1",
        classLevelCategory: "JSS",
        periodsPerWeek: 3,
        concurrencyGroupId: null,
        subject: { isGroup: false },
      }),
    },
    subject: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ isGroup: false }),
    },
  };
}

function buildStudentSubjectEnrollmentsMock() {
  return { syncEnrollmentsForClassSubject: jest.fn().mockResolvedValue(undefined) };
}

describe("ClassSubjectService.create", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let studentSubjectEnrollments: ReturnType<typeof buildStudentSubjectEnrollmentsMock>;
  let service: ClassSubjectService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    studentSubjectEnrollments = buildStudentSubjectEnrollmentsMock();
    service = new ClassSubjectService(prisma as never, studentSubjectEnrollments as never);
  });

  it("rejects a DEPARTMENT assignment with no departmentId", async () => {
    await expect(
      service.create({ classLevelCategory: "SSS", subjectId: "subj-1", type: SubjectType.DEPARTMENT } as never),
    ).rejects.toThrow(/departmentId is required/);
    expect(prisma.classSubject.create).not.toHaveBeenCalled();
  });

  it("rejects a non-DEPARTMENT assignment with a departmentId", async () => {
    await expect(
      service.create({
        classLevelCategory: "JSS",
        subjectId: "subj-1",
        type: SubjectType.GENERAL,
        departmentId: "dept-1",
      } as never),
    ).rejects.toThrow(/departmentId is only valid/);
    expect(prisma.classSubject.create).not.toHaveBeenCalled();
  });

  // Regression: a freshly-created COMPULSORY row must backfill students
  // already sitting in that class category, same as flipping an existing
  // row to COMPULSORY via update() — see the ClassSubjectService.update
  // "backfills students" test below for the full scenario this covers.
  it("syncs enrollments for the newly-created row", async () => {
    await service.create({ classLevelCategory: "JSS", subjectId: "subj-1", type: SubjectType.COMPULSORY } as never);

    expect(studentSubjectEnrollments.syncEnrollmentsForClassSubject).toHaveBeenCalledWith("cs-1");
  });
});

describe("ClassSubjectService.update", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let studentSubjectEnrollments: ReturnType<typeof buildStudentSubjectEnrollmentsMock>;
  let service: ClassSubjectService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    studentSubjectEnrollments = buildStudentSubjectEnrollmentsMock();
    service = new ClassSubjectService(prisma as never, studentSubjectEnrollments as never);
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

  it("rejects moving to DEPARTMENT without a departmentId", async () => {
    await expect(service.update("cs-1", { type: SubjectType.DEPARTMENT } as never)).rejects.toThrow(
      /departmentId is required/,
    );
    expect(prisma.classSubject.update).not.toHaveBeenCalled();
  });

  it("passes non-type updates straight through", async () => {
    await service.update("cs-1", {} as never);

    expect(prisma.classSubject.update).toHaveBeenCalledWith({ where: { id: "cs-1" }, data: {} });
  });

  // Regression: this is the actual JSS 1 CCA/Yoruba bug — flipping an
  // existing ClassSubject to COMPULSORY (or creating one as COMPULSORY,
  // covered by the create() test above) must backfill students already
  // assigned to that class category, since syncCompulsoryEnrollmentsOnClassAssignment
  // only fires at class-assignment time and would otherwise never reach them.
  it("backfills students already in the class category when type becomes COMPULSORY", async () => {
    await service.update("cs-1", { type: SubjectType.COMPULSORY } as never);

    expect(studentSubjectEnrollments.syncEnrollmentsForClassSubject).toHaveBeenCalledWith("cs-1");
  });

  it("still syncs (a no-op inside the sync method) when type is omitted from the update", async () => {
    await service.update("cs-1", {} as never);

    expect(studentSubjectEnrollments.syncEnrollmentsForClassSubject).toHaveBeenCalledWith("cs-1");
  });
});
