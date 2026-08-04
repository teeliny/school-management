import { ClassSubjectTermStatusService } from "./class-subject-term-status";

function buildPrismaMock() {
  return {
    classSubject: { findUnique: jest.fn() },
    subject: { findUnique: jest.fn() },
    term: { findUniqueOrThrow: jest.fn() },
    classSubjectTermStatus: { upsert: jest.fn(), findUnique: jest.fn() },
  };
}

const classSubject = { id: "cs-1", subjectId: "subj-parent", academicSessionId: "session-1" };
const parentSubject = { id: "subj-parent", name: "Basic Science and Technology", parentSubjectId: null, isActive: true };
const childSubject = { id: "subj-child", name: "Basic Science", parentSubjectId: "subj-parent", isActive: true };
const otherSubject = { id: "subj-other", name: "Mathematics", parentSubjectId: null, isActive: true };

describe("ClassSubjectTermStatusService.setStatus", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: ClassSubjectTermStatusService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new ClassSubjectTermStatusService(prisma as never);
    prisma.classSubject.findUnique.mockResolvedValue(classSubject);
    prisma.term.findUniqueOrThrow.mockResolvedValue({ id: "term-1", academicSessionId: "session-1" });
    prisma.classSubjectTermStatus.upsert.mockImplementation(({ create }) => create);
  });

  it("disables the class-subject itself (subjectId === classSubject.subjectId)", async () => {
    prisma.subject.findUnique.mockResolvedValue(parentSubject);

    await service.setStatus({ classSubjectId: "cs-1", subjectId: "subj-parent", termId: "term-1" }, false, "user-1");

    expect(prisma.classSubjectTermStatus.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ isActive: false, disabledByUserId: "user-1" }),
        update: expect.objectContaining({ isActive: false, disabledByUserId: "user-1" }),
      }),
    );
  });

  it("disables a grouped subject's child (sub-subject) independently of the parent", async () => {
    prisma.subject.findUnique.mockResolvedValue(childSubject);

    await service.setStatus({ classSubjectId: "cs-1", subjectId: "subj-child", termId: "term-1" }, false, "user-1");

    expect(prisma.classSubjectTermStatus.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { classSubjectId_subjectId_termId: { classSubjectId: "cs-1", subjectId: "subj-child", termId: "term-1" } },
      }),
    );
  });

  it("re-enabling clears disabledAt/disabledByUserId", async () => {
    prisma.subject.findUnique.mockResolvedValue(parentSubject);

    await service.setStatus({ classSubjectId: "cs-1", subjectId: "subj-parent", termId: "term-1" }, true, "user-1");

    expect(prisma.classSubjectTermStatus.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { isActive: true, disabledAt: null, disabledByUserId: null },
      }),
    );
  });

  it("rejects a subject that isn't the assignment's subject or one of its children", async () => {
    prisma.subject.findUnique.mockResolvedValue(otherSubject);

    await expect(
      service.setStatus({ classSubjectId: "cs-1", subjectId: "subj-other", termId: "term-1" }, false, "user-1"),
    ).rejects.toThrow(/does not belong to this class-subject assignment/);
  });

  it("rejects a term outside the class-subject's academic session", async () => {
    prisma.subject.findUnique.mockResolvedValue(parentSubject);
    prisma.term.findUniqueOrThrow.mockResolvedValue({ id: "term-2", academicSessionId: "other-session" });

    await expect(
      service.setStatus({ classSubjectId: "cs-1", subjectId: "subj-parent", termId: "term-2" }, false, "user-1"),
    ).rejects.toThrow(/does not belong to this class-subject assignment's academic session/);
  });
});

describe("ClassSubjectTermStatusService.assertActiveForTerm", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: ClassSubjectTermStatusService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new ClassSubjectTermStatusService(prisma as never);
  });

  it("is a no-op when the subject was never disabled for this class+term", async () => {
    prisma.subject.findUnique.mockResolvedValue(parentSubject);
    prisma.classSubject.findUnique.mockResolvedValue(classSubject);
    prisma.classSubjectTermStatus.findUnique.mockResolvedValue(null);

    await expect(
      service.assertActiveForTerm({
        subjectId: "subj-parent",
        classLevelId: "level-1",
        academicSessionId: "session-1",
        termId: "term-1",
      }),
    ).resolves.toBeUndefined();
  });

  it("throws when the subject is disabled catalogue-wide (Subject.isActive), regardless of class/term", async () => {
    prisma.subject.findUnique.mockResolvedValue({ ...parentSubject, isActive: false });

    await expect(
      service.assertActiveForTerm({
        subjectId: "subj-parent",
        classLevelId: "level-1",
        academicSessionId: "session-1",
        termId: "term-1",
      }),
    ).rejects.toThrow(/is disabled/);
    expect(prisma.classSubject.findUnique).not.toHaveBeenCalled();
  });

  it("throws when the subject was explicitly disabled for this class+term", async () => {
    prisma.subject.findUnique.mockResolvedValue(parentSubject);
    prisma.classSubject.findUnique.mockResolvedValue(classSubject);
    prisma.classSubjectTermStatus.findUnique.mockResolvedValue({ isActive: false });

    await expect(
      service.assertActiveForTerm({
        subjectId: "subj-parent",
        classLevelId: "level-1",
        academicSessionId: "session-1",
        termId: "term-1",
      }),
    ).rejects.toThrow(/is disabled for this class for this term/);
  });

  it("is a no-op when the subject isn't assigned to that class at all (a different concern)", async () => {
    prisma.subject.findUnique.mockResolvedValue(parentSubject);
    prisma.classSubject.findUnique.mockResolvedValue(null);

    await expect(
      service.assertActiveForTerm({
        subjectId: "subj-parent",
        classLevelId: "level-1",
        academicSessionId: "session-1",
        termId: "term-1",
      }),
    ).resolves.toBeUndefined();
    expect(prisma.classSubjectTermStatus.findUnique).not.toHaveBeenCalled();
  });

  it("resolves a group child's classSubject lookup via its parent's subjectId", async () => {
    prisma.subject.findUnique.mockResolvedValue(childSubject);
    prisma.classSubject.findUnique.mockResolvedValue(classSubject);
    prisma.classSubjectTermStatus.findUnique.mockResolvedValue(null);

    await service.assertActiveForTerm({
      subjectId: "subj-child",
      classLevelId: "level-1",
      academicSessionId: "session-1",
      termId: "term-1",
    });

    expect(prisma.classSubject.findUnique).toHaveBeenCalledWith({
      where: {
        classLevelId_subjectId_academicSessionId: {
          classLevelId: "level-1",
          subjectId: "subj-parent",
          academicSessionId: "session-1",
        },
      },
    });
  });
});
