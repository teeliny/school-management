import { TermReportCardStatus, TermReportCardType } from "@prisma/client";
import { TermReportCardService } from "./term-report-card";
import type { RequestUser } from "../auth/jwt.strategy";

function buildPrismaMock() {
  return {
    termReportCard: { findUniqueOrThrow: jest.fn(), update: jest.fn(), findMany: jest.fn(), upsert: jest.fn() },
    parentProfile: { findUnique: jest.fn() },
    studentProfile: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), findMany: jest.fn() },
    term: { findUniqueOrThrow: jest.fn() },
    studentSubjectEnrollment: { findMany: jest.fn() },
    subjectTermResult: { findMany: jest.fn() },
    skillAssessmentItem: { findMany: jest.fn() },
    skillRating: { findMany: jest.fn() },
    reportComment: { findFirst: jest.fn(), findMany: jest.fn() },
    studentGuardian: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

function buildStaffAssignmentsMock() {
  return { activeAssignedClassArmIds: jest.fn(), hasActiveSchoolWideAssignment: jest.fn().mockResolvedValue(false) };
}

function buildQueueMock() {
  return { add: jest.fn() };
}

function buildNotificationsMock() {
  return { notify: jest.fn() };
}

describe("TermReportCardService.generateFullTerm (PRD FR4.7 — Admin-initiated)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let reportCardQueue: ReturnType<typeof buildQueueMock>;
  let service: TermReportCardService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    reportCardQueue = buildQueueMock();
    service = new TermReportCardService(
      prisma as never,
      buildStaffAssignmentsMock() as never,
      reportCardQueue as never,
      buildNotificationsMock() as never,
    );
  });

  it("upserts a GENERATING FULL_TERM row and enqueues the PDF job", async () => {
    prisma.termReportCard.upsert.mockResolvedValue({ id: "rc-1" });

    await service.generateFullTerm({ studentId: "student-1", termId: "term-1" }, "admin-1");

    expect(prisma.termReportCard.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          studentId: "student-1",
          termId: "term-1",
          reportType: TermReportCardType.FULL_TERM,
          status: TermReportCardStatus.GENERATING,
          generatedByUserId: "admin-1",
        }),
      }),
    );
    expect(reportCardQueue.add).toHaveBeenCalledWith("generate", {
      studentId: "student-1",
      termId: "term-1",
      reportType: "FULL_TERM",
    });
  });
});

describe("TermReportCardService.publish (mid-term gate — scores-only, no comments/skills)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: TermReportCardService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new TermReportCardService(
      prisma as never,
      buildStaffAssignmentsMock() as never,
      buildQueueMock() as never,
      buildNotificationsMock() as never,
    );
  });

  it("blocks publish while the report card is still GENERATING", async () => {
    prisma.termReportCard.findUniqueOrThrow.mockResolvedValue({
      id: "rc-1",
      status: TermReportCardStatus.GENERATING,
      reportType: TermReportCardType.MID_TERM,
    });

    await expect(service.publish("rc-1")).rejects.toThrow(/GENERATING/);
    expect(prisma.termReportCard.update).not.toHaveBeenCalled();
  });

  it("allows publish once the report card is READY", async () => {
    prisma.termReportCard.findUniqueOrThrow.mockResolvedValue({
      id: "rc-1",
      status: TermReportCardStatus.READY,
      reportType: TermReportCardType.MID_TERM,
    });
    prisma.termReportCard.update.mockResolvedValue({ id: "rc-1", status: TermReportCardStatus.PUBLISHED });

    await service.publish("rc-1");

    expect(prisma.termReportCard.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rc-1" },
        data: expect.objectContaining({ status: TermReportCardStatus.PUBLISHED }),
      }),
    );
  });

  it("rejects publishing an already-PUBLISHED report card", async () => {
    prisma.termReportCard.findUniqueOrThrow.mockResolvedValue({
      id: "rc-1",
      status: TermReportCardStatus.PUBLISHED,
      reportType: TermReportCardType.MID_TERM,
    });

    await expect(service.publish("rc-1")).rejects.toThrow(/PUBLISHED/);
  });
});

describe("TermReportCardService.publish — FULL_TERM completeness gate (PRD FR4.7)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: TermReportCardService;
  let notifications: { notify: jest.Mock };

  const STUDENT = { currentClass: { id: "arm-1", classLevelId: "level-1" } };
  const TERM = { id: "term-1", academicSessionId: "session-1" };

  beforeEach(() => {
    prisma = buildPrismaMock();
    notifications = buildNotificationsMock();
    service = new TermReportCardService(
      prisma as never,
      buildStaffAssignmentsMock() as never,
      buildQueueMock() as never,
      notifications as never,
    );
    prisma.termReportCard.findUniqueOrThrow.mockResolvedValue({
      id: "rc-1",
      status: TermReportCardStatus.READY,
      reportType: TermReportCardType.FULL_TERM,
      studentId: "student-1",
      termId: "term-1",
      student: { user: { firstName: "Ada", lastName: "Lovelace" } },
      term: { name: "1st Term" },
    });
    prisma.studentProfile.findUniqueOrThrow.mockResolvedValue(STUDENT);
    prisma.term.findUniqueOrThrow.mockResolvedValue(TERM);
    prisma.studentGuardian.findMany.mockResolvedValue([
      { parent: { userId: "guardian-user-1" } },
      { parent: { userId: "guardian-user-2" } },
    ]);
  });

  function mockAllComplete() {
    prisma.studentSubjectEnrollment.findMany.mockResolvedValue([{ subjectId: "subj-1" }]);
    prisma.subjectTermResult.findMany.mockResolvedValue([{ subjectId: "subj-1" }]);
    prisma.skillAssessmentItem.findMany.mockResolvedValue([{ id: "skill-1" }]);
    prisma.skillRating.findMany.mockResolvedValue([{ skillAssessmentItemId: "skill-1" }]);
    prisma.reportComment.findFirst.mockResolvedValue({ id: "comment-1" });
  }

  it("publishes once every required piece is present", async () => {
    mockAllComplete();
    prisma.termReportCard.update.mockResolvedValue({ id: "rc-1", status: TermReportCardStatus.PUBLISHED });

    await service.publish("rc-1");

    expect(prisma.termReportCard.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: TermReportCardStatus.PUBLISHED }) }),
    );
  });

  it("notifies every guardian on record, not just one, once published", async () => {
    mockAllComplete();
    prisma.termReportCard.update.mockResolvedValue({ id: "rc-1", status: TermReportCardStatus.PUBLISHED });

    await service.publish("rc-1");

    expect(notifications.notify).toHaveBeenCalledTimes(2);
    expect(notifications.notify).toHaveBeenCalledWith("guardian-user-1", "REPORT_CARD_PUBLISHED", {
      studentName: "Ada Lovelace",
      termName: "1st Term",
    });
    expect(notifications.notify).toHaveBeenCalledWith("guardian-user-2", "REPORT_CARD_PUBLISHED", {
      studentName: "Ada Lovelace",
      termName: "1st Term",
    });
  });

  it("a notify() failure doesn't propagate out of publish()", async () => {
    mockAllComplete();
    prisma.termReportCard.update.mockResolvedValue({ id: "rc-1", status: TermReportCardStatus.PUBLISHED });
    notifications.notify.mockRejectedValue(new Error("notify down"));

    await expect(service.publish("rc-1")).resolves.toBeDefined();
  });

  it("rejects when a SubjectTermResult is missing for an actively-enrolled subject", async () => {
    mockAllComplete();
    prisma.subjectTermResult.findMany.mockResolvedValue([]);

    await expect(service.publish("rc-1")).rejects.toThrow(/Missing SubjectTermResult/);
    expect(prisma.termReportCard.update).not.toHaveBeenCalled();
  });

  it("rejects when a SkillRating is missing for an active SkillAssessmentItem", async () => {
    mockAllComplete();
    prisma.skillRating.findMany.mockResolvedValue([]);

    await expect(service.publish("rc-1")).rejects.toThrow(/Missing SkillRating/);
    expect(prisma.termReportCard.update).not.toHaveBeenCalled();
  });

  it("rejects when the CLASS_TEACHER comment is missing", async () => {
    mockAllComplete();
    prisma.reportComment.findFirst.mockResolvedValueOnce(null);

    await expect(service.publish("rc-1")).rejects.toThrow(/Missing CLASS_TEACHER comment/);
    expect(prisma.termReportCard.update).not.toHaveBeenCalled();
  });

  it("rejects when the PRINCIPAL comment is missing", async () => {
    mockAllComplete();
    prisma.reportComment.findFirst.mockResolvedValueOnce({ id: "comment-1" }).mockResolvedValueOnce(null);

    await expect(service.publish("rc-1")).rejects.toThrow(/Missing PRINCIPAL comment/);
    expect(prisma.termReportCard.update).not.toHaveBeenCalled();
  });
});

describe("TermReportCardService.classReadiness / generateForClass", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let reportCardQueue: ReturnType<typeof buildQueueMock>;
  let service: TermReportCardService;

  const TERM = { id: "term-1", academicSessionId: "session-1" };
  const STUDENT_A = { id: "student-a", user: { firstName: "Ada", lastName: "Lovelace" } };
  const STUDENT_B = { id: "student-b", user: { firstName: "Bea", lastName: "Smith" } };

  beforeEach(() => {
    prisma = buildPrismaMock();
    reportCardQueue = buildQueueMock();
    service = new TermReportCardService(
      prisma as never,
      buildStaffAssignmentsMock() as never,
      reportCardQueue as never,
      buildNotificationsMock() as never,
    );
    prisma.term.findUniqueOrThrow.mockResolvedValue(TERM);
    prisma.studentProfile.findMany.mockResolvedValue([STUDENT_A, STUDENT_B]);
    prisma.studentSubjectEnrollment.findMany.mockResolvedValue([
      { studentId: "student-a", subjectId: "subj-1" },
      { studentId: "student-b", subjectId: "subj-1" },
    ]);
    prisma.skillAssessmentItem.findMany.mockResolvedValue([{ id: "skill-1" }]);
  });

  function mockStudentAComplete() {
    prisma.subjectTermResult.findMany.mockResolvedValue([{ studentId: "student-a", subjectId: "subj-1" }]);
    prisma.skillRating.findMany.mockResolvedValue([{ studentId: "student-a", skillAssessmentItemId: "skill-1" }]);
    prisma.reportComment.findMany.mockResolvedValue([
      { studentId: "student-a", commentType: "CLASS_TEACHER" },
      { studentId: "student-a", commentType: "PRINCIPAL" },
    ]);
  }

  it("marks a student ready only once every piece is present, and reports what's missing otherwise", async () => {
    mockStudentAComplete();

    const result = await service.classReadiness("arm-1", "term-1");

    expect(result.totalStudents).toBe(2);
    const a = result.students.find((s) => s.studentId === "student-a")!;
    const b = result.students.find((s) => s.studentId === "student-b")!;
    expect(a.ready).toBe(true);
    expect(a.missing).toEqual([]);
    expect(b.ready).toBe(false);
    expect(b.missing).toEqual([
      "Missing SubjectTermResult for 1 actively-enrolled subject(s)",
      "Missing SkillRating for 1 active skill assessment item(s)",
      "Missing CLASS_TEACHER comment",
      "Missing PRINCIPAL comment",
    ]);
  });

  it("generateForClass only generates for ready students, skipping the rest with their missing reasons", async () => {
    mockStudentAComplete();
    prisma.termReportCard.upsert.mockResolvedValue({ id: "rc-a" });

    const result = await service.generateForClass({ classArmId: "arm-1", termId: "term-1" }, "admin-1");

    expect(result.generatedCount).toBe(1);
    expect(result.generatedStudentIds).toEqual(["student-a"]);
    expect(reportCardQueue.add).toHaveBeenCalledTimes(1);
    expect(reportCardQueue.add).toHaveBeenCalledWith("generate", {
      studentId: "student-a",
      termId: "term-1",
      reportType: "FULL_TERM",
    });
    expect(result.skipped).toEqual([
      expect.objectContaining({ studentId: "student-b", studentName: "Bea Smith" }),
    ]);
  });
});

describe("TermReportCardService.findForUser (PRD §5 visibility)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let staffAssignments: ReturnType<typeof buildStaffAssignmentsMock>;
  let service: TermReportCardService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    staffAssignments = buildStaffAssignmentsMock();
    service = new TermReportCardService(
      prisma as never,
      staffAssignments as never,
      buildQueueMock() as never,
      buildNotificationsMock() as never,
    );
  });

  it("lets Admin see report cards of any status", async () => {
    const user: RequestUser = { id: "user-1", roles: ["ADMIN"], assignmentTypes: [] };
    prisma.termReportCard.findMany.mockResolvedValue([
      {
        id: "rc-1",
        status: TermReportCardStatus.GENERATING,
        student: {
          admissionNumber: "ADM-1",
          user: { firstName: "Ada", lastName: "Lovelace" },
          currentClass: { name: "A", classLevel: { name: "JSS 1" } },
        },
      },
    ]);

    const result = await service.findForUser(user, {});

    expect(prisma.termReportCard.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
    expect(result).toHaveLength(1);
  });

  it("scopes a Parent to only their wards' published report cards", async () => {
    const user: RequestUser = { id: "user-1", roles: ["PARENT"], assignmentTypes: [] };
    prisma.parentProfile.findUnique.mockResolvedValue({ id: "parent-1" });
    prisma.termReportCard.findMany.mockResolvedValue([]);

    await service.findForUser(user, {});

    expect(prisma.termReportCard.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        // Each role's scoping condition is OR'd together rather than merged
        // into one object — necessary so a user holding multiple roles (e.g.
        // Staff who is also a Parent) sees the union of what each role can
        // see, not just whichever branch ran last.
        where: { OR: [{ status: TermReportCardStatus.PUBLISHED, student: { guardians: { some: { parentId: "parent-1" } } } }] },
      }),
    );
  });

  it("returns an empty list for a Parent with no ParentProfile", async () => {
    const user: RequestUser = { id: "user-1", roles: ["PARENT"], assignmentTypes: [] };
    prisma.parentProfile.findUnique.mockResolvedValue(null);

    const result = await service.findForUser(user, {});

    expect(result).toEqual([]);
    expect(prisma.termReportCard.findMany).not.toHaveBeenCalled();
  });

  it("scopes a Student to only their own published report cards", async () => {
    const user: RequestUser = { id: "user-1", roles: ["STUDENT"], assignmentTypes: [] };
    prisma.studentProfile.findUnique.mockResolvedValue({ id: "student-1" });
    prisma.termReportCard.findMany.mockResolvedValue([]);

    await service.findForUser(user, {});

    expect(prisma.termReportCard.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ studentId: "student-1", status: TermReportCardStatus.PUBLISHED }] },
      }),
    );
  });

  it("scopes STAFF (class/subject teacher) to their assigned class arms, any status", async () => {
    const user: RequestUser = { id: "user-1", roles: ["STAFF"], assignmentTypes: ["CLASS_TEACHER"] };
    staffAssignments.activeAssignedClassArmIds.mockResolvedValue(["arm-1", "arm-2"]);
    prisma.termReportCard.findMany.mockResolvedValue([]);

    await service.findForUser(user, {});

    expect(prisma.termReportCard.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ student: { currentClassId: { in: ["arm-1", "arm-2"] } } }] },
      }),
    );
    // Unlike parent/student, staff isn't restricted to PUBLISHED-only.
    expect(prisma.termReportCard.findMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: expect.anything() }) }),
    );
  });

  it("returns an empty list for STAFF with no active class-arm assignment", async () => {
    const user: RequestUser = { id: "user-1", roles: ["STAFF"], assignmentTypes: [] };
    staffAssignments.activeAssignedClassArmIds.mockResolvedValue([]);

    const result = await service.findForUser(user, {});

    expect(result).toEqual([]);
    expect(prisma.termReportCard.findMany).not.toHaveBeenCalled();
  });

  it("gives a Principal/Headteacher (school-wide STAFF assignment) every report card, any status", async () => {
    const user: RequestUser = { id: "user-1", roles: ["STAFF"], assignmentTypes: ["PRINCIPAL"] };
    staffAssignments.hasActiveSchoolWideAssignment.mockResolvedValue(true);
    prisma.termReportCard.findMany.mockResolvedValue([]);

    await service.findForUser(user, {});

    expect(staffAssignments.activeAssignedClassArmIds).not.toHaveBeenCalled();
    expect(prisma.termReportCard.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { OR: [{}] } }),
    );
  });
});
