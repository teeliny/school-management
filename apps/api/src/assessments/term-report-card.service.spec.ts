import { NotFoundException } from "@nestjs/common";
import { TermReportCardStatus, TermReportCardType } from "@prisma/client";
import { TermReportCardService } from "./term-report-card";
import type { RequestUser } from "../auth/jwt.strategy";

function buildPrismaMock() {
  return {
    termReportCard: {
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
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
  return { activeAssignedClassArmIds: jest.fn() };
}

function buildQueueMock() {
  return { add: jest.fn() };
}

function buildNotificationsMock() {
  return { notify: jest.fn() };
}

function buildStorageMock() {
  return { getSignedUrl: jest.fn(async (key: string) => `https://signed.example/${key}?fresh`) };
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
      buildStorageMock() as never,
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
      buildStorageMock() as never,
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
      buildStorageMock() as never,
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
      studentName: "LOVELACE ADA",
      termName: "1st Term",
    });
    expect(notifications.notify).toHaveBeenCalledWith("guardian-user-2", "REPORT_CARD_PUBLISHED", {
      studentName: "LOVELACE ADA",
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
      buildStorageMock() as never,
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
      expect.objectContaining({ studentId: "student-b", studentName: "SMITH BEA" }),
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
      buildStorageMock() as never,
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

  it("keeps a since-departed student's cards for the terms they completed, but not the term they left in", async () => {
    const user: RequestUser = { id: "user-1", roles: ["STAFF"], assignmentTypes: ["CLASS_TEACHER"] };
    staffAssignments.activeAssignedClassArmIds.mockResolvedValue(["arm-1"]);
    const leftOn = new Date("2027-04-20"); // after 2nd term ends, before 3rd term ends
    const card = (id: string, termEnd: string) => ({
      id,
      studentId: "student-gone",
      term: { endDate: new Date(termEnd) },
      student: { status: "WITHDRAWN", inactiveSince: leftOn, currentClass: null },
    });
    prisma.termReportCard.findMany.mockResolvedValue([
      card("card-t1", "2026-12-18"),
      card("card-t2", "2027-04-16"),
      card("card-t3", "2027-07-30"),
    ]);

    const result = await service.findForUser(user, {});

    expect(result.map((c) => c.id)).toEqual(["card-t1", "card-t2"]);
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

  it("scopes a Principal to only JSS/SSS report cards, any status", async () => {
    const user: RequestUser = { id: "user-1", roles: ["STAFF"], assignmentTypes: ["PRINCIPAL"] };
    prisma.termReportCard.findMany.mockResolvedValue([]);

    await service.findForUser(user, {});

    expect(staffAssignments.activeAssignedClassArmIds).not.toHaveBeenCalled();
    expect(prisma.termReportCard.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ student: { currentClass: { classLevel: { category: { in: ["JSS", "SSS"] } } } } }] },
      }),
    );
  });

  it("scopes a Headteacher to only Creche/Reception/Nursery/Primary report cards, any status", async () => {
    const user: RequestUser = { id: "user-1", roles: ["STAFF"], assignmentTypes: ["HEADTEACHER"] };
    prisma.termReportCard.findMany.mockResolvedValue([]);

    await service.findForUser(user, {});

    expect(staffAssignments.activeAssignedClassArmIds).not.toHaveBeenCalled();
    expect(prisma.termReportCard.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ student: { currentClass: { classLevel: { category: { in: ["CRECHE", "RECEPTION", "NURSERY", "PRIMARY"] } } } } }],
        },
      }),
    );
  });
});

describe("TermReportCardService.publishAll (Report Cards page \"Publish all\")", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let notifications: { notify: jest.Mock };
  let service: TermReportCardService;
  const END_DATE = new Date("2025-12-18");

  function card(id: string, reportType: TermReportCardType) {
    return {
      id,
      studentId: `student-${id}`,
      termId: "term-1",
      reportType,
      status: TermReportCardStatus.READY,
      student: { user: { firstName: "Ada", lastName: id } },
      term: { name: "1st Term" },
    };
  }

  beforeEach(() => {
    prisma = buildPrismaMock();
    notifications = buildNotificationsMock();
    service = new TermReportCardService(
      prisma as never,
      buildStaffAssignmentsMock() as never,
      buildQueueMock() as never,
      notifications as never,
      buildStorageMock() as never,
    );
    prisma.term.findUniqueOrThrow.mockResolvedValue({ id: "term-1", academicSessionId: "session-1", endDate: END_DATE });
  });

  it("publishes every READY, unflagged, in-term card for the requested scope", async () => {
    prisma.termReportCard.findMany.mockResolvedValue([card("a", TermReportCardType.MID_TERM), card("b", TermReportCardType.MID_TERM)]);

    const result = await service.publishAll({ termId: "term-1", reportType: TermReportCardType.MID_TERM, classArmId: "arm-1" });

    expect(prisma.termReportCard.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          termId: "term-1",
          status: TermReportCardStatus.READY,
          reportType: TermReportCardType.MID_TERM,
          needsRegeneration: false,
          student: { currentClassId: "arm-1", OR: [{ status: "ACTIVE" }, { inactiveSince: { gte: END_DATE } }] },
        },
      }),
    );
    expect(prisma.termReportCard.update).toHaveBeenCalledTimes(2);
    expect(prisma.termReportCard.update).toHaveBeenCalledWith({
      where: { id: "a" },
      data: { status: TermReportCardStatus.PUBLISHED, publishedAt: expect.any(Date) },
    });
    expect(result).toEqual({ publishedCount: 2, skipped: [], needsRegenerationCount: 0, leftSchoolCount: 0 });
    // MID_TERM publishes never notify.
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it("reports how many were held back for needing regeneration or for a student who left", async () => {
    prisma.termReportCard.findMany.mockResolvedValue([]);
    prisma.termReportCard.count.mockResolvedValueOnce(3).mockResolvedValueOnce(2);

    const result = await service.publishAll({ termId: "term-1" });

    expect(result).toEqual({ publishedCount: 0, skipped: [], needsRegenerationCount: 3, leftSchoolCount: 2 });
    expect(prisma.termReportCard.update).not.toHaveBeenCalled();
  });

  it("skips (doesn't force-publish) a FULL_TERM card that fails the FR4.7 gate, and notifies guardians for one that passes", async () => {
    prisma.termReportCard.findMany.mockResolvedValue([card("ok", TermReportCardType.FULL_TERM), card("bad", TermReportCardType.FULL_TERM)]);
    prisma.studentProfile.findUniqueOrThrow.mockResolvedValue({ currentClass: { id: "arm-1" } });
    prisma.studentSubjectEnrollment.findMany.mockResolvedValue([{ subjectId: "subj-1" }]);
    prisma.subjectTermResult.findMany.mockResolvedValue([{ subjectId: "subj-1" }]);
    prisma.skillAssessmentItem.findMany.mockResolvedValue([]);
    prisma.skillRating.findMany.mockResolvedValue([]);
    prisma.reportComment.findFirst
      .mockResolvedValueOnce({ id: "ct" }) // "ok": class teacher
      .mockResolvedValueOnce({ id: "pr" }) // "ok": principal
      .mockResolvedValueOnce(null); // "bad": class teacher missing
    prisma.studentGuardian.findMany.mockResolvedValue([{ parent: { userId: "guardian-1" } }]);

    const result = await service.publishAll({ termId: "term-1", reportType: TermReportCardType.FULL_TERM });

    expect(result.publishedCount).toBe(1);
    expect(result.skipped).toEqual([{ id: "bad", studentName: expect.any(String), reason: "Missing CLASS_TEACHER comment" }]);
    expect(prisma.termReportCard.update).toHaveBeenCalledTimes(1);
    expect(prisma.termReportCard.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "ok" } }));
    expect(notifications.notify).toHaveBeenCalledWith("guardian-1", "REPORT_CARD_PUBLISHED", expect.anything());
  });
});

describe("TermReportCardService.findForUser — type/status/needs-regeneration filters", () => {
  it("passes reportType, status and needsRegeneration through to the query", async () => {
    const prisma = buildPrismaMock();
    const service = new TermReportCardService(
      prisma as never,
      buildStaffAssignmentsMock() as never,
      buildQueueMock() as never,
      buildNotificationsMock() as never,
      buildStorageMock() as never,
    );
    prisma.termReportCard.findMany.mockResolvedValue([]);

    await service.findForUser(
      { id: "admin-1", roles: ["ADMIN"], assignmentTypes: [] },
      { termId: "term-1", reportType: TermReportCardType.MID_TERM, status: TermReportCardStatus.READY, needsRegeneration: true },
    );

    expect(prisma.termReportCard.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { termId: "term-1", reportType: "MID_TERM", status: "READY", needsRegeneration: true },
      }),
    );
  });
});

describe("TermReportCardService — PDF links signed on demand", () => {
  const student = { admissionNumber: "A1", user: { firstName: "Ada", lastName: "Okoye" }, currentClass: null };
  const admin = { id: "admin-1", roles: ["ADMIN"], assignmentTypes: [] };

  function build() {
    const prisma = buildPrismaMock();
    const storage = buildStorageMock();
    const service = new TermReportCardService(
      prisma as never,
      buildStaffAssignmentsMock() as never,
      buildQueueMock() as never,
      buildNotificationsMock() as never,
      storage as never,
    );
    return { prisma, storage, service };
  }

  it("lists cards with a hasPdf flag and no download link, without signing anything", async () => {
    const { prisma, storage, service } = build();
    prisma.termReportCard.findMany.mockResolvedValue([
      { id: "rc-1", studentId: "s1", termId: "t1", reportType: TermReportCardType.MID_TERM, pdfUrl: "https://stale", student },
      { id: "rc-2", studentId: "s2", termId: "t1", reportType: TermReportCardType.FULL_TERM, pdfUrl: null, student },
    ]);

    const cards = await service.findForUser(admin, {});

    expect(cards.map((c) => c.hasPdf)).toEqual([true, false]);
    expect(cards.every((c) => !("pdfUrl" in c))).toBe(true);
    expect(storage.getSignedUrl).not.toHaveBeenCalled();
  });

  it("signs a fresh link from the card's storage key, scoped to that one visible card", async () => {
    const { prisma, storage, service } = build();
    prisma.termReportCard.findMany.mockResolvedValue([
      { id: "rc-1", studentId: "s1", termId: "t1", reportType: TermReportCardType.MID_TERM, pdfUrl: "https://stale", student },
    ]);

    const result = await service.pdfUrlForUser(admin, "rc-1");

    expect(result).toEqual({ url: "https://signed.example/report-cards/s1/t1/mid-term.pdf?fresh" });
    expect(storage.getSignedUrl).toHaveBeenCalledWith("report-cards/s1/t1/mid-term.pdf", 300);
    expect(prisma.termReportCard.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "rc-1" }) }));
  });

  it("404s when the card isn't visible to the caller or has no PDF yet", async () => {
    const { prisma, storage, service } = build();
    prisma.termReportCard.findMany.mockResolvedValueOnce([]);
    await expect(service.pdfUrlForUser(admin, "rc-hidden")).rejects.toBeInstanceOf(NotFoundException);

    prisma.termReportCard.findMany.mockResolvedValueOnce([
      { id: "rc-2", studentId: "s2", termId: "t1", reportType: TermReportCardType.FULL_TERM, pdfUrl: null, student },
    ]);
    await expect(service.pdfUrlForUser(admin, "rc-2")).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.getSignedUrl).not.toHaveBeenCalled();
  });
});
