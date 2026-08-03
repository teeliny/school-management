import { SubjectTermResultService } from "./subject-term-result.service";

function buildPrismaMock() {
  return {
    term: { findUniqueOrThrow: jest.fn(), findMany: jest.fn() },
    assessmentComponent: { findMany: jest.fn() },
    classArm: { findMany: jest.fn() },
    studentSubjectEnrollment: { findMany: jest.fn() },
    scoreEntry: { findMany: jest.fn() },
    gradeScale: { findMany: jest.fn() },
    subjectGroupWeight: { findMany: jest.fn() },
    subjectTermResult: { upsert: jest.fn(), update: jest.fn(), findMany: jest.fn() },
  };
}

const TERM = { id: "term-1", academicSessionId: "session-1" };
const GRADE_SCALES = [
  { minScore: 70, maxScore: 100, grade: "A1", remark: "Excellent" },
  { minScore: 50, maxScore: 69.99, grade: "B2", remark: "Very Good" },
  { minScore: 0, maxScore: 49.99, grade: "F9", remark: "Fail" },
];

describe("SubjectTermResultService.aggregateForClassLevelTerm (PRD §3.6/FR4.4)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: SubjectTermResultService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new SubjectTermResultService(prisma as never);
    prisma.term.findUniqueOrThrow.mockResolvedValue(TERM);
    prisma.assessmentComponent.findMany.mockResolvedValue([{ id: "ca" }, { id: "exam" }]);
    prisma.classArm.findMany.mockResolvedValue([{ id: "arm-1" }]);
    prisma.gradeScale.findMany.mockResolvedValue(GRADE_SCALES);
    prisma.subjectTermResult.upsert.mockImplementation((args) =>
      Promise.resolve({ id: `${args.create.studentId}:${args.create.subjectId}` }),
    );
    prisma.subjectTermResult.update.mockResolvedValue({});
  });

  it("sums a plain (non-group) subject's scores across components and grades the total", async () => {
    prisma.studentSubjectEnrollment.findMany.mockResolvedValue([
      { studentId: "student-1", subjectId: "subj-math", classArmId: "arm-1", subject: { isGroup: false } },
    ]);
    prisma.scoreEntry.findMany.mockResolvedValue([
      { studentId: "student-1", subjectId: "subj-math", score: 15 },
      { studentId: "student-1", subjectId: "subj-math", score: 50 },
    ]);

    await service.aggregateForClassLevelTerm("term-1", "level-1");

    expect(prisma.subjectTermResult.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.subjectTermResult.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { studentId_subjectId_termId: { studentId: "student-1", subjectId: "subj-math", termId: "term-1" } },
        create: expect.objectContaining({ totalScore: 65, grade: "B2", remark: "Very Good" }),
      }),
    );
  });

  it("writes a null grade when no GradeScale row matches the total", async () => {
    prisma.gradeScale.findMany.mockResolvedValue([]);
    prisma.studentSubjectEnrollment.findMany.mockResolvedValue([
      { studentId: "student-1", subjectId: "subj-math", classArmId: "arm-1", subject: { isGroup: false } },
    ]);
    prisma.scoreEntry.findMany.mockResolvedValue([{ studentId: "student-1", subjectId: "subj-math", score: 65 }]);

    await service.aggregateForClassLevelTerm("term-1", "level-1");

    expect(prisma.subjectTermResult.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ grade: null }) }),
    );
  });

  it("rolls up a grouped subject's children into a SubjectGroupWeight-weighted parent total (Basic Science and Technology)", async () => {
    prisma.studentSubjectEnrollment.findMany.mockResolvedValue([
      {
        studentId: "student-1",
        subjectId: "subj-bst",
        classArmId: "arm-1",
        subject: { isGroup: true },
      },
    ]);
    prisma.subjectGroupWeight.findMany.mockResolvedValue([
      { groupSubjectId: "subj-bst", childSubjectId: "subj-basic-science", weight: 25 },
      { groupSubjectId: "subj-bst", childSubjectId: "subj-basic-technology", weight: 75 },
    ]);
    prisma.scoreEntry.findMany.mockResolvedValue([
      // Basic Science: 40/100
      { studentId: "student-1", subjectId: "subj-basic-science", score: 40 },
      // Basic Technology: 80/100
      { studentId: "student-1", subjectId: "subj-basic-technology", score: 80 },
    ]);

    await service.aggregateForClassLevelTerm("term-1", "level-1");

    // Child rows get their own SubjectTermResult...
    expect(prisma.subjectTermResult.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ subjectId: "subj-basic-science", totalScore: 40 }),
      }),
    );
    expect(prisma.subjectTermResult.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ subjectId: "subj-basic-technology", totalScore: 80 }),
      }),
    );
    // ...and the parent is the weight-normalized average: (40*25 + 80*75) / 100 = 70.
    expect(prisma.subjectTermResult.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ subjectId: "subj-bst", totalScore: 70, grade: "A1" }),
      }),
    );
    expect(prisma.subjectTermResult.upsert).toHaveBeenCalledTimes(3);
  });

  it("does nothing when there are no components for this term/class level", async () => {
    prisma.assessmentComponent.findMany.mockResolvedValue([]);

    await service.aggregateForClassLevelTerm("term-1", "level-1");

    expect(prisma.studentSubjectEnrollment.findMany).not.toHaveBeenCalled();
    expect(prisma.subjectTermResult.upsert).not.toHaveBeenCalled();
  });

  it("ranks students within the same (subjectId, classArmId) group by total score, ties sharing a rank", async () => {
    prisma.studentSubjectEnrollment.findMany.mockResolvedValue([
      { studentId: "student-1", subjectId: "subj-math", classArmId: "arm-1", subject: { isGroup: false } },
      { studentId: "student-2", subjectId: "subj-math", classArmId: "arm-1", subject: { isGroup: false } },
      { studentId: "student-3", subjectId: "subj-math", classArmId: "arm-1", subject: { isGroup: false } },
    ]);
    prisma.scoreEntry.findMany.mockResolvedValue([
      { studentId: "student-1", subjectId: "subj-math", score: 90 },
      { studentId: "student-2", subjectId: "subj-math", score: 90 },
      { studentId: "student-3", subjectId: "subj-math", score: 60 },
    ]);

    await service.aggregateForClassLevelTerm("term-1", "level-1");

    expect(prisma.subjectTermResult.update).toHaveBeenCalledWith({
      where: { id: "student-1:subj-math" },
      data: { position: 1 },
    });
    expect(prisma.subjectTermResult.update).toHaveBeenCalledWith({
      where: { id: "student-2:subj-math" },
      data: { position: 1 },
    });
    // Third place is 3, not 2 — two students already ranked ahead (tied 1st).
    expect(prisma.subjectTermResult.update).toHaveBeenCalledWith({
      where: { id: "student-3:subj-math" },
      data: { position: 3 },
    });
  });

  it("ranks each (subjectId, classArmId) group independently", async () => {
    prisma.studentSubjectEnrollment.findMany.mockResolvedValue([
      { studentId: "student-1", subjectId: "subj-math", classArmId: "arm-1", subject: { isGroup: false } },
      { studentId: "student-1", subjectId: "subj-english", classArmId: "arm-1", subject: { isGroup: false } },
    ]);
    prisma.scoreEntry.findMany.mockResolvedValue([
      { studentId: "student-1", subjectId: "subj-math", score: 90 },
      { studentId: "student-1", subjectId: "subj-english", score: 40 },
    ]);

    await service.aggregateForClassLevelTerm("term-1", "level-1");

    // The only student in each subject group is always rank 1, regardless
    // of their score in the other subject.
    expect(prisma.subjectTermResult.update).toHaveBeenCalledWith({
      where: { id: "student-1:subj-math" },
      data: { position: 1 },
    });
    expect(prisma.subjectTermResult.update).toHaveBeenCalledWith({
      where: { id: "student-1:subj-english" },
      data: { position: 1 },
    });
  });
});

describe("SubjectTermResultService.computeAnnualSummary (PRD §3.6 — last-term annual grading)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: SubjectTermResultService;

  const TERM_1 = { id: "term-1", academicSessionId: "session-1", startDate: new Date("2025-09-01") };
  const TERM_2 = { id: "term-2", academicSessionId: "session-1", startDate: new Date("2026-01-01") };
  const TERM_3 = { id: "term-3", academicSessionId: "session-1", startDate: new Date("2026-05-01") };

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new SubjectTermResultService(prisma as never);
    prisma.gradeScale.findMany.mockResolvedValue(GRADE_SCALES);
  });

  it("returns null when the given term isn't the last one in its session", async () => {
    prisma.term.findUniqueOrThrow.mockResolvedValue(TERM_1);
    prisma.term.findMany.mockResolvedValue([TERM_1, TERM_2, TERM_3]);

    const result = await service.computeAnnualSummary("student-1", "term-1");

    expect(result).toBeNull();
    expect(prisma.subjectTermResult.findMany).not.toHaveBeenCalled();
  });

  it("returns null when the student has no reportable SubjectTermResult rows across the session", async () => {
    prisma.term.findUniqueOrThrow.mockResolvedValue(TERM_3);
    prisma.term.findMany.mockResolvedValue([TERM_1, TERM_2, TERM_3]);
    prisma.subjectTermResult.findMany.mockResolvedValue([]);

    const result = await service.computeAnnualSummary("student-1", "term-3");

    expect(result).toBeNull();
  });

  it("averages a subject's totals across every term that has one, excluding a missing term", async () => {
    prisma.term.findUniqueOrThrow.mockResolvedValue(TERM_3);
    prisma.term.findMany.mockResolvedValue([TERM_1, TERM_2, TERM_3]);
    prisma.subjectTermResult.findMany.mockImplementation((args) => {
      if (args.where.subjectId) {
        // Classmate ranking query — just this one student for simplicity here.
        return Promise.resolve([
          { studentId: "student-1", totalScore: 80 },
          { studentId: "student-1", totalScore: 90 },
        ]);
      }
      // "Own results" query — no Term 2 result (student joined late / missing data).
      return Promise.resolve([
        { studentId: "student-1", subjectId: "subj-math", classArmId: "arm-1", termId: "term-1", totalScore: 80, subject: { parentSubjectId: null } },
        { studentId: "student-1", subjectId: "subj-math", classArmId: "arm-1", termId: "term-3", totalScore: 90, subject: { parentSubjectId: null } },
      ]);
    });

    const result = await service.computeAnnualSummary("student-1", "term-3");

    expect(result?.subjects).toEqual([
      { subjectId: "subj-math", average: 85, grade: "A1", remark: "Excellent", position: expect.any(Number) },
    ]);
  });

  it("excludes a grouped subject's children from the annual average (parentSubjectId set)", async () => {
    prisma.term.findUniqueOrThrow.mockResolvedValue(TERM_3);
    prisma.term.findMany.mockResolvedValue([TERM_1, TERM_2, TERM_3]);
    prisma.subjectTermResult.findMany.mockImplementation((args) => {
      if (args.where.subjectId) {
        return Promise.resolve([{ studentId: "student-1", totalScore: 80 }]);
      }
      return Promise.resolve([
        { studentId: "student-1", subjectId: "subj-math", classArmId: "arm-1", termId: "term-3", totalScore: 80, subject: { parentSubjectId: null } },
        {
          studentId: "student-1",
          subjectId: "subj-basic-science",
          classArmId: "arm-1",
          termId: "term-3",
          totalScore: 95,
          subject: { parentSubjectId: "subj-bst" },
        },
      ]);
    });

    const result = await service.computeAnnualSummary("student-1", "term-3");

    expect(result?.subjects.map((s) => s.subjectId)).toEqual(["subj-math"]);
  });

  it("ranks the student against classmates in the same classArm by their own annual average", async () => {
    prisma.term.findUniqueOrThrow.mockResolvedValue(TERM_3);
    prisma.term.findMany.mockResolvedValue([TERM_1, TERM_2, TERM_3]);
    prisma.subjectTermResult.findMany.mockImplementation((args) => {
      if (args.where.subjectId) {
        return Promise.resolve([
          { studentId: "student-1", totalScore: 70 },
          { studentId: "student-2", totalScore: 95 },
        ]);
      }
      return Promise.resolve([
        { studentId: "student-1", subjectId: "subj-math", classArmId: "arm-1", termId: "term-3", totalScore: 70, subject: { parentSubjectId: null } },
      ]);
    });

    const result = await service.computeAnnualSummary("student-1", "term-3");

    expect(result?.subjects[0]).toMatchObject({ subjectId: "subj-math", position: 2 });
  });

  it("computes the overall average/grade/remark as the mean of the per-subject annual averages", async () => {
    prisma.term.findUniqueOrThrow.mockResolvedValue(TERM_3);
    prisma.term.findMany.mockResolvedValue([TERM_1, TERM_2, TERM_3]);
    prisma.subjectTermResult.findMany.mockImplementation((args) => {
      if (args.where.subjectId) {
        return Promise.resolve([{ studentId: "student-1", totalScore: 100 }]);
      }
      return Promise.resolve([
        { studentId: "student-1", subjectId: "subj-math", classArmId: "arm-1", termId: "term-3", totalScore: 90, subject: { parentSubjectId: null } },
        { studentId: "student-1", subjectId: "subj-english", classArmId: "arm-1", termId: "term-3", totalScore: 60, subject: { parentSubjectId: null } },
      ]);
    });

    const result = await service.computeAnnualSummary("student-1", "term-3");

    expect(result?.overallAverage).toBe(75);
    expect(result?.overallGrade).toBe("A1");
    expect(result?.overallRemark).toBe("Excellent");
  });
});
