import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { AssessmentComponentType, ClassLevelCategory, HomeworkStatus, NotificationType } from "@prisma/client";
import { HomeworkService } from "./homework";
import type { RequestUser } from "../auth/jwt.strategy";
import type { CreateHomeworkDto } from "./dto/homework.dto";

function buildPrismaMock() {
  return {
    subject: { findUniqueOrThrow: jest.fn() },
    classArm: { findUniqueOrThrow: jest.fn() },
    term: { findUniqueOrThrow: jest.fn() },
    assessmentComponent: { findUniqueOrThrow: jest.fn() },
    homework: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
    homeworkMark: { findUnique: jest.fn(), findMany: jest.fn(), upsert: jest.fn(), count: jest.fn() },
    homeworkSubmission: { findUnique: jest.fn(), findMany: jest.fn(), upsert: jest.fn(), count: jest.fn() },
    homeworkAttachment: { findMany: jest.fn() },
    studentSubjectEnrollment: { findMany: jest.fn() },
    staffProfile: { findUnique: jest.fn() },
    staffAssignment: { findMany: jest.fn() },
    parentProfile: { findUnique: jest.fn() },
    studentProfile: { findUnique: jest.fn() },
    // Present only so the isolation tests can assert they're never touched
    // by the plain homework paths.
    scoreEntry: { findMany: jest.fn(), upsert: jest.fn(), create: jest.fn(), update: jest.fn() },
    subjectTermResult: { upsert: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  };
}

const TEACHER: RequestUser = { id: "teacher-user", roles: ["STAFF"], assignmentTypes: ["SUBJECT_TEACHER"] };
const PARENT: RequestUser = { id: "parent-user", roles: ["PARENT"], assignmentTypes: [] };

const ROSTER_STUDENT = {
  id: "student-1",
  admissionNumber: "ADM/001",
  userId: "student-user-1",
  user: { firstName: "Ada", lastName: "Obi" },
  guardians: [{ parent: { userId: "parent-user" } }],
};

function homework(overrides: Record<string, unknown> = {}) {
  return {
    id: "hw-1",
    subjectId: "subj-1",
    classArmId: "arm-1",
    termId: "term-1",
    title: "Fractions worksheet",
    dueDate: new Date("2026-10-05"),
    maxScore: 10,
    allowOnlineSubmission: false,
    status: HomeworkStatus.PUBLISHED,
    publishedAt: new Date("2026-09-29"),
    caComponentId: null,
    caComponent: null,
    caTransferredAt: null,
    subject: { id: "subj-1", name: "Mathematics", code: "MTH" },
    classArm: { id: "arm-1", name: "A", classLevelId: "level-1", classLevel: { name: "JSS 1", category: ClassLevelCategory.JSS } },
    term: { id: "term-1", name: "First Term" },
    ...overrides,
  };
}

function createDto(overrides: Partial<CreateHomeworkDto> = {}): CreateHomeworkDto {
  return {
    subjectId: "subj-1",
    classArmId: "arm-1",
    termId: "term-1",
    title: "Fractions worksheet",
    instructions: "Do questions 1-10",
    dueDate: new Date("2026-10-05"),
    maxScore: 10,
    ...overrides,
  };
}

describe("HomeworkService (PRD §3.6a)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let staffAssignments: { findActiveAssignment: jest.Mock };
  let termStatus: { assertActiveForTerm: jest.Mock };
  let levelStatus: { assertActiveForClassLevel: jest.Mock };
  let scoreEntries: { enter: jest.Mock };
  let notifications: { notify: jest.Mock };
  let storage: { put: jest.Mock; getSignedUrl: jest.Mock; delete: jest.Mock };
  let service: HomeworkService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    staffAssignments = { findActiveAssignment: jest.fn().mockResolvedValue({ id: "sa-1", staffId: "staff-1" }) };
    termStatus = { assertActiveForTerm: jest.fn() };
    levelStatus = { assertActiveForClassLevel: jest.fn() };
    scoreEntries = { enter: jest.fn() };
    notifications = { notify: jest.fn() };
    storage = { put: jest.fn(), getSignedUrl: jest.fn().mockResolvedValue("https://signed"), delete: jest.fn() };
    service = new HomeworkService(
      prisma as never,
      staffAssignments as never,
      termStatus as never,
      levelStatus as never,
      scoreEntries as never,
      notifications as never,
      storage as never,
    );

    prisma.subject.findUniqueOrThrow.mockResolvedValue({ id: "subj-1", isGroup: false });
    prisma.classArm.findUniqueOrThrow.mockResolvedValue({
      id: "arm-1",
      classLevelId: "level-1",
      academicSessionId: "session-1",
      classLevel: { category: ClassLevelCategory.JSS },
    });
    prisma.term.findUniqueOrThrow.mockResolvedValue({ id: "term-1", academicSessionId: "session-1" });
    prisma.homework.create.mockImplementation(({ data }) => Promise.resolve({ id: "hw-new", ...data }));
    prisma.homework.findFirst.mockResolvedValue(null);
    prisma.studentSubjectEnrollment.findMany.mockResolvedValue([{ student: ROSTER_STUDENT }]);
    prisma.homeworkMark.findUnique.mockResolvedValue(null);
    prisma.homeworkMark.upsert.mockImplementation(({ create }) => Promise.resolve({ id: "mark-1", ...create }));
  });

  describe("create", () => {
    it("lets the assigned subject teacher create homework, defaulting online submission to off", async () => {
      const created = await service.create(createDto(), TEACHER, false);
      expect(created).toMatchObject({ allowOnlineSubmission: false, caComponentId: null, createdByUserId: "teacher-user" });
    });

    it("rejects a teacher who isn't assigned to that subject+class", async () => {
      staffAssignments.findActiveAssignment.mockResolvedValue(null);
      await expect(service.create(createDto(), TEACHER, false)).rejects.toThrow(ForbiddenException);
    });

    it("lets Admin/Super-Admin create as override without a subject-teacher assignment", async () => {
      staffAssignments.findActiveAssignment.mockResolvedValue(null);
      await expect(service.create(createDto(), { id: "sa", roles: ["SUPER_ADMIN"], assignmentTypes: [] }, true)).resolves.toBeDefined();
    });

    it("rejects a group subject even under override", async () => {
      prisma.subject.findUniqueOrThrow.mockResolvedValue({ id: "subj-1", isGroup: true });
      await expect(service.create(createDto(), TEACHER, true)).rejects.toThrow(BadRequestException);
    });

    it("checks both the per-term and per-class-level subject disables", async () => {
      await service.create(createDto(), TEACHER, false);
      expect(termStatus.assertActiveForTerm).toHaveBeenCalled();
      expect(levelStatus.assertActiveForClassLevel).toHaveBeenCalledWith(expect.objectContaining({ classLevelId: "level-1" }));
    });

    describe("CA link", () => {
      const caComponent = { id: "ca-1", name: "CA 1", type: AssessmentComponentType.CA, termId: "term-1", classLevelCategory: ClassLevelCategory.JSS, maxScore: 20 };

      it("accepts a CA component for the same term and class group", async () => {
        prisma.assessmentComponent.findUniqueOrThrow.mockResolvedValue(caComponent);
        await expect(service.create(createDto({ caComponentId: "ca-1" }), TEACHER, false)).resolves.toMatchObject({ caComponentId: "ca-1" });
      });

      it("rejects linking to a mid-term or exam component", async () => {
        prisma.assessmentComponent.findUniqueOrThrow.mockResolvedValue({ ...caComponent, type: AssessmentComponentType.EXAM });
        await expect(service.create(createDto({ caComponentId: "ca-1" }), TEACHER, false)).rejects.toThrow(/only count toward a CA/);
      });

      it("rejects a CA from another class group", async () => {
        prisma.assessmentComponent.findUniqueOrThrow.mockResolvedValue({ ...caComponent, classLevelCategory: ClassLevelCategory.SSS });
        await expect(service.create(createDto({ caComponentId: "ca-1" }), TEACHER, false)).rejects.toThrow(BadRequestException);
      });

      it("requires a max score when linked", async () => {
        prisma.assessmentComponent.findUniqueOrThrow.mockResolvedValue(caComponent);
        await expect(service.create(createDto({ caComponentId: "ca-1", maxScore: null }), TEACHER, false)).rejects.toThrow(/max score/);
      });

      it("allows only one homework per CA per subject+class arm", async () => {
        prisma.assessmentComponent.findUniqueOrThrow.mockResolvedValue(caComponent);
        prisma.homework.findFirst.mockResolvedValue({ title: "Earlier homework" });
        await expect(service.create(createDto({ caComponentId: "ca-1" }), TEACHER, false)).rejects.toThrow(/already counts toward CA 1/);
      });
    });
  });

  describe("mark", () => {
    it("records the mark and notifies the student and their guardians", async () => {
      prisma.homework.findUnique.mockResolvedValue(homework());
      const { mark } = await service.mark("hw-1", "student-1", { score: 8, correction: "Check Q4" }, TEACHER, false);
      expect(mark).toMatchObject({ score: 8, correction: "Check Q4" });
      const recipients = notifications.notify.mock.calls.map((c) => c[0]);
      expect(recipients.sort()).toEqual(["parent-user", "student-user-1"]);
      expect(notifications.notify).toHaveBeenCalledWith(
        "parent-user",
        NotificationType.HOMEWORK_MARKED,
        expect.objectContaining({ scoreText: " — 8/10", studentName: "OBI ADA" }),
      );
    });

    it("never touches ScoreEntry or SubjectTermResult — marks stay out of term grading", async () => {
      prisma.homework.findUnique.mockResolvedValue(homework({ caComponentId: "ca-1", caComponent: { id: "ca-1" } }));
      await service.mark("hw-1", "student-1", { score: 8 }, TEACHER, false);
      expect(scoreEntries.enter).not.toHaveBeenCalled();
      for (const fn of [...Object.values(prisma.scoreEntry), ...Object.values(prisma.subjectTermResult)]) {
        expect(fn).not.toHaveBeenCalled();
      }
    });

    it("rejects a score above the homework's max", async () => {
      prisma.homework.findUnique.mockResolvedValue(homework());
      await expect(service.mark("hw-1", "student-1", { score: 11 }, TEACHER, false)).rejects.toThrow(/max score of 10/);
    });

    it("requires a score when the homework has a max score", async () => {
      prisma.homework.findUnique.mockResolvedValue(homework());
      await expect(service.mark("hw-1", "student-1", { correction: "ok" }, TEACHER, false)).rejects.toThrow(/Enter a score/);
    });

    it("rejects a score on a marked-only homework (no max score)", async () => {
      prisma.homework.findUnique.mockResolvedValue(homework({ maxScore: null }));
      await expect(service.mark("hw-1", "student-1", { score: 5 }, TEACHER, false)).rejects.toThrow(/no max score/);
    });

    it("rejects marking a DRAFT homework", async () => {
      prisma.homework.findUnique.mockResolvedValue(homework({ status: HomeworkStatus.DRAFT }));
      await expect(service.mark("hw-1", "student-1", { score: 5 }, TEACHER, false)).rejects.toThrow(/Publish/);
    });

    it("rejects a student not enrolled in the subject for that class/term", async () => {
      prisma.homework.findUnique.mockResolvedValue(homework());
      prisma.studentSubjectEnrollment.findMany.mockResolvedValue([]);
      await expect(service.mark("hw-1", "student-9", { score: 5 }, TEACHER, false)).rejects.toThrow(/not actively enrolled/);
    });

    it("rejects a teacher of a different subject", async () => {
      prisma.homework.findUnique.mockResolvedValue(homework());
      staffAssignments.findActiveAssignment.mockResolvedValue(null);
      await expect(service.mark("hw-1", "student-1", { score: 5 }, TEACHER, false)).rejects.toThrow(ForbiddenException);
    });
  });

  describe("submit", () => {
    beforeEach(() => {
      prisma.parentProfile.findUnique.mockResolvedValue({ wards: [{ studentId: "student-1" }] });
      prisma.homeworkSubmission.findUnique.mockResolvedValue(null);
      prisma.homeworkSubmission.upsert.mockImplementation(({ create }) => Promise.resolve({ id: "sub-1", ...create }));
      prisma.staffAssignment.findMany.mockResolvedValue([{ staff: { userId: "teacher-user" } }]);
    });

    it("is refused when the teacher hasn't enabled online submission", async () => {
      prisma.homework.findUnique.mockResolvedValue(homework({ allowOnlineSubmission: false }));
      await expect(service.submit("hw-1", "student-1", { text: "done" }, PARENT)).rejects.toThrow(/doesn't accept online submissions/);
    });

    it("lets a guardian submit for their ward and notifies the subject teacher", async () => {
      prisma.homework.findUnique.mockResolvedValue(homework({ allowOnlineSubmission: true, dueDate: new Date("2999-01-01") }));
      const submission = await service.submit("hw-1", "student-1", { text: "done" }, PARENT);
      expect(submission).toMatchObject({ text: "done", isLate: false, submittedByUserId: "parent-user" });
      expect(notifications.notify).toHaveBeenCalledWith("teacher-user", NotificationType.HOMEWORK_SUBMITTED, expect.anything());
    });

    it("flags a submission after the due date as late", async () => {
      prisma.homework.findUnique.mockResolvedValue(homework({ allowOnlineSubmission: true, dueDate: new Date("2000-01-01") }));
      await expect(service.submit("hw-1", "student-1", {}, PARENT)).resolves.toMatchObject({ isLate: true });
    });

    it("refuses a parent submitting for someone else's child", async () => {
      prisma.homework.findUnique.mockResolvedValue(homework({ allowOnlineSubmission: true }));
      await expect(service.submit("hw-1", "student-2", {}, PARENT)).rejects.toThrow(ForbiddenException);
    });

    it("locks the submission once it has been marked", async () => {
      prisma.homework.findUnique.mockResolvedValue(homework({ allowOnlineSubmission: true }));
      prisma.homeworkMark.findUnique.mockResolvedValue({ id: "mark-1" });
      await expect(service.submit("hw-1", "student-1", {}, PARENT)).rejects.toThrow(/already been marked/);
    });
  });

  describe("findOne visibility", () => {
    it("hides a DRAFT homework from a parent", async () => {
      prisma.homework.findUnique.mockResolvedValue(homework({ status: HomeworkStatus.DRAFT }));
      staffAssignments.findActiveAssignment.mockResolvedValue(null);
      prisma.parentProfile.findUnique.mockResolvedValue({ wards: [{ studentId: "student-1" }] });
      await expect(service.findOne("hw-1", PARENT, false)).rejects.toThrow(NotFoundException);
    });

    it("shows a parent only their own ward's row", async () => {
      prisma.homework.findUnique.mockResolvedValue(homework());
      staffAssignments.findActiveAssignment.mockResolvedValue(null);
      prisma.parentProfile.findUnique.mockResolvedValue({ wards: [{ studentId: "student-1" }] });
      prisma.homeworkAttachment.findMany.mockResolvedValue([]);
      prisma.homeworkSubmission.findMany.mockResolvedValue([]);
      prisma.homeworkMark.findMany.mockResolvedValue([]);
      const result = await service.findOne("hw-1", PARENT, false);
      expect(result.viewerCanManage).toBe(false);
      expect(prisma.studentSubjectEnrollment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ studentId: { in: ["student-1"] } }) }),
      );
      expect(prisma.homeworkMark.findMany).toHaveBeenCalledWith({ where: { homeworkId: "hw-1", studentId: { in: ["student-1"] } } });
    });
  });

  describe("transferToGradebook (opt-in CA bridge)", () => {
    const linked = () =>
      homework({
        caComponentId: "ca-1",
        caComponent: { id: "ca-1", name: "CA 1", type: AssessmentComponentType.CA, maxScore: 20, status: "OPEN" },
      });

    beforeEach(() => {
      prisma.studentSubjectEnrollment.findMany.mockResolvedValue([
        { student: ROSTER_STUDENT },
        { student: { ...ROSTER_STUDENT, id: "student-2", user: { firstName: "Bayo", lastName: "Ade" } } },
      ]);
      prisma.homeworkMark.findMany.mockResolvedValue([{ studentId: "student-1", score: 7 }]);
      prisma.scoreEntry.findMany.mockResolvedValue([]);
    });

    it("scales each marked score to the CA's max and writes through ScoreEntryService.enter, skipping unmarked", async () => {
      prisma.homework.findUnique.mockResolvedValue(linked());
      const result = await service.transferToGradebook("hw-1", TEACHER, false, false);
      expect(scoreEntries.enter).toHaveBeenCalledTimes(1);
      expect(scoreEntries.enter).toHaveBeenCalledWith(
        { studentId: "student-1", subjectId: "subj-1", assessmentComponentId: "ca-1", classArmId: "arm-1", score: 14 },
        TEACHER,
        false,
        "hw-1",
      );
      expect(result).toMatchObject({ transferred: 1, skippedUnmarked: 1 });
      expect(prisma.homework.update).toHaveBeenCalledWith({ where: { id: "hw-1" }, data: { caTransferredAt: expect.any(Date) } });
    });

    it("refuses a homework with no CA link", async () => {
      prisma.homework.findUnique.mockResolvedValue(homework());
      await expect(service.transferToGradebook("hw-1", TEACHER, false, false)).rejects.toThrow(/isn't linked/);
    });

    it("doesn't mark the homework transferred if the gradebook write fails (e.g. CA closed)", async () => {
      prisma.homework.findUnique.mockResolvedValue(linked());
      scoreEntries.enter.mockRejectedValue(new BadRequestException("This assessment component is not open for score entry"));
      await expect(service.transferToGradebook("hw-1", TEACHER, false, false)).rejects.toThrow(/not open/);
      expect(prisma.homework.update).not.toHaveBeenCalled();
    });
  });
});
