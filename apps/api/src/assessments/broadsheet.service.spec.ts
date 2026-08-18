import { BadRequestException } from "@nestjs/common";
import { BroadsheetService } from "./broadsheet";

function buildPrismaMock() {
  return {
    term: { findUniqueOrThrow: jest.fn(), findMany: jest.fn() },
    academicSession: { findUniqueOrThrow: jest.fn() },
    classLevel: { findUniqueOrThrow: jest.fn() },
    classArm: { findMany: jest.fn(), findUniqueOrThrow: jest.fn() },
    classSubject: { findMany: jest.fn() },
    studentProfile: { findMany: jest.fn() },
    subjectTermResult: { findMany: jest.fn() },
    gradeScale: { findMany: jest.fn() },
  };
}

const TERM = { id: "term-1", name: "1st Term", academicSessionId: "session-1" };
const CLASS_LEVEL = { id: "level-jss1", name: "JSS 1", category: "JSS" };
const GRADE_SCALES = [
  { minScore: 70, maxScore: 100, grade: "A1", remark: "Excellent" },
  { minScore: 50, maxScore: 69.99, grade: "B2", remark: "Very Good" },
  { minScore: 0, maxScore: 49.99, grade: "F9", remark: "Fail" },
];

function student(id: string, admissionNumber: string, classArmId: string) {
  return {
    id,
    admissionNumber,
    currentClassId: classArmId,
    user: { firstName: id, lastName: "Test" },
  };
}

describe("BroadsheetService.build", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: BroadsheetService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new BroadsheetService(prisma as never);
    prisma.term.findUniqueOrThrow.mockResolvedValue(TERM);
    prisma.gradeScale.findMany.mockResolvedValue(GRADE_SCALES);
    prisma.classSubject.findMany.mockResolvedValue([
      { subject: { id: "subj-math", name: "Mathematics" } },
      { subject: { id: "subj-eng", name: "English Language" } },
    ]);
  });

  it("throws when neither classLevelId nor classArmId is given", async () => {
    await expect(service.build({ termId: "term-1" })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("throws when neither termId nor academicSessionId is given", async () => {
    await expect(service.build({ classLevelId: "level-jss1" })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("throws when both termId and academicSessionId are given", async () => {
    await expect(
      service.build({ termId: "term-1", academicSessionId: "session-1", classLevelId: "level-jss1" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("defaults to CLASS_LEVEL scope, combining every arm under the level", async () => {
    prisma.classLevel.findUniqueOrThrow.mockResolvedValue(CLASS_LEVEL);
    prisma.classArm.findMany.mockResolvedValue([
      { id: "arm-diamond", name: "Diamond" },
      { id: "arm-jacinth", name: "Jacinth" },
    ]);
    prisma.studentProfile.findMany.mockResolvedValue([
      student("s1", "A001", "arm-diamond"),
      student("s2", "A002", "arm-jacinth"),
    ]);
    prisma.subjectTermResult.findMany.mockResolvedValue([
      { studentId: "s1", subjectId: "subj-math", totalScore: 90, grade: "A1" },
      { studentId: "s2", subjectId: "subj-math", totalScore: 60, grade: "B2" },
    ]);

    const result = await service.build({ termId: "term-1", classLevelId: "level-jss1" });

    expect(result.scope).toBe("CLASS_LEVEL");
    expect(result.classArmId).toBeNull();
    expect(prisma.classArm.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { classLevelId: "level-jss1", academicSessionId: "session-1" } }),
    );
    // Both arms' students are ranked together — s1 (90) beats s2 (60) for Mathematics.
    const mathCell = (row: (typeof result.rows)[number]) => row.subjects.find((s) => s.subjectId === "subj-math")!;
    expect(mathCell(result.rows.find((r) => r.studentId === "s1")!)).toMatchObject({ totalScore: 90, position: 1 });
    expect(mathCell(result.rows.find((r) => r.studentId === "s2")!)).toMatchObject({ totalScore: 60, position: 2 });
  });

  it("falls back to CLASS_ARM scope when classArmId is given instead", async () => {
    prisma.classArm.findUniqueOrThrow.mockResolvedValue({ id: "arm-diamond", name: "Diamond", classLevel: CLASS_LEVEL });
    prisma.studentProfile.findMany.mockResolvedValue([student("s1", "A001", "arm-diamond")]);
    prisma.subjectTermResult.findMany.mockResolvedValue([
      { studentId: "s1", subjectId: "subj-math", totalScore: 90, grade: "A1" },
    ]);

    const result = await service.build({ termId: "term-1", classArmId: "arm-diamond" });

    expect(result.scope).toBe("CLASS_ARM");
    expect(result.classArmId).toBe("arm-diamond");
    expect(prisma.studentProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { currentClassId: { in: ["arm-diamond"] } } }),
    );
  });

  it("computes a blank cell (not a zero) for a subject the student has no SubjectTermResult for", async () => {
    prisma.classLevel.findUniqueOrThrow.mockResolvedValue(CLASS_LEVEL);
    prisma.classArm.findMany.mockResolvedValue([{ id: "arm-diamond", name: "Diamond" }]);
    prisma.studentProfile.findMany.mockResolvedValue([student("s1", "A001", "arm-diamond")]);
    prisma.subjectTermResult.findMany.mockResolvedValue([
      { studentId: "s1", subjectId: "subj-math", totalScore: 80, grade: "A1" },
      // No result at all for subj-eng.
    ]);

    const result = await service.build({ termId: "term-1", classLevelId: "level-jss1" });

    const row = result.rows[0]!;
    expect(row.subjects.find((s) => s.subjectId === "subj-eng")).toEqual({
      subjectId: "subj-eng",
      totalScore: null,
      grade: null,
      position: null,
    });
    // Overall average only counts the one subject that actually has a score.
    expect(row.overallAverage).toBe(80);
  });

  it("ranks overall position by each student's average across their scored subjects, ties sharing a rank", async () => {
    prisma.classLevel.findUniqueOrThrow.mockResolvedValue(CLASS_LEVEL);
    prisma.classArm.findMany.mockResolvedValue([{ id: "arm-diamond", name: "Diamond" }]);
    prisma.studentProfile.findMany.mockResolvedValue([
      student("s1", "A001", "arm-diamond"),
      student("s2", "A002", "arm-diamond"),
      student("s3", "A003", "arm-diamond"),
    ]);
    prisma.subjectTermResult.findMany.mockResolvedValue([
      { studentId: "s1", subjectId: "subj-math", totalScore: 90, grade: "A1" },
      { studentId: "s1", subjectId: "subj-eng", totalScore: 90, grade: "A1" },
      { studentId: "s2", subjectId: "subj-math", totalScore: 90, grade: "A1" },
      { studentId: "s2", subjectId: "subj-eng", totalScore: 90, grade: "A1" },
      { studentId: "s3", subjectId: "subj-math", totalScore: 50, grade: "B2" },
      { studentId: "s3", subjectId: "subj-eng", totalScore: 50, grade: "B2" },
    ]);

    const result = await service.build({ termId: "term-1", classLevelId: "level-jss1" });

    const byId = (id: string) => result.rows.find((r) => r.studentId === id)!;
    expect(byId("s1")).toMatchObject({ overallAverage: 90, overallGrade: "A1", overallPosition: 1 });
    expect(byId("s2")).toMatchObject({ overallAverage: 90, overallGrade: "A1", overallPosition: 1 });
    // Third place is 3, not 2 — standard competition ranking (two tied ahead).
    expect(byId("s3")).toMatchObject({ overallAverage: 50, overallGrade: "B2", overallPosition: 3 });
  });

  it("sorts by a subject column server-side, blank cells always last regardless of direction", async () => {
    prisma.classLevel.findUniqueOrThrow.mockResolvedValue(CLASS_LEVEL);
    prisma.classArm.findMany.mockResolvedValue([{ id: "arm-diamond", name: "Diamond" }]);
    prisma.studentProfile.findMany.mockResolvedValue([
      student("s1", "A001", "arm-diamond"),
      student("s2", "A002", "arm-diamond"),
      student("s3", "A003", "arm-diamond"),
    ]);
    prisma.subjectTermResult.findMany.mockResolvedValue([
      { studentId: "s1", subjectId: "subj-math", totalScore: 50, grade: "B2" },
      { studentId: "s2", subjectId: "subj-math", totalScore: 90, grade: "A1" },
      // s3 has no Mathematics result at all.
    ]);

    const desc = await service.build({ termId: "term-1", classLevelId: "level-jss1", sortBy: "subj-math", sortDir: "desc" });
    expect(desc.rows.map((r) => r.studentId)).toEqual(["s2", "s1", "s3"]);

    const asc = await service.build({ termId: "term-1", classLevelId: "level-jss1", sortBy: "subj-math", sortDir: "asc" });
    // s3 (blank) still last, even ascending.
    expect(asc.rows.map((r) => r.studentId)).toEqual(["s1", "s2", "s3"]);
  });

  it("sorts by average, defaulting to descending (highest first) when sortDir is omitted", async () => {
    prisma.classLevel.findUniqueOrThrow.mockResolvedValue(CLASS_LEVEL);
    prisma.classArm.findMany.mockResolvedValue([{ id: "arm-diamond", name: "Diamond" }]);
    prisma.studentProfile.findMany.mockResolvedValue([
      student("s1", "A001", "arm-diamond"),
      student("s2", "A002", "arm-diamond"),
    ]);
    prisma.subjectTermResult.findMany.mockResolvedValue([
      { studentId: "s1", subjectId: "subj-math", totalScore: 50, grade: "B2" },
      { studentId: "s2", subjectId: "subj-math", totalScore: 90, grade: "A1" },
    ]);

    const byAverage = await service.build({ termId: "term-1", classLevelId: "level-jss1", sortBy: "average" });
    expect(byAverage.rows.map((r) => r.studentId)).toEqual(["s2", "s1"]);
  });

  it("sorts by position numerically — ascending puts rank 1 first, descending puts it last", async () => {
    prisma.classLevel.findUniqueOrThrow.mockResolvedValue(CLASS_LEVEL);
    prisma.classArm.findMany.mockResolvedValue([{ id: "arm-diamond", name: "Diamond" }]);
    prisma.studentProfile.findMany.mockResolvedValue([
      student("s1", "A001", "arm-diamond"),
      student("s2", "A002", "arm-diamond"),
    ]);
    prisma.subjectTermResult.findMany.mockResolvedValue([
      { studentId: "s1", subjectId: "subj-math", totalScore: 50, grade: "B2" },
      { studentId: "s2", subjectId: "subj-math", totalScore: 90, grade: "A1" },
    ]);

    // s2 (90) outranks s1 (50), so s2's overallPosition is 1, s1's is 2.
    const asc = await service.build({ termId: "term-1", classLevelId: "level-jss1", sortBy: "position", sortDir: "asc" });
    expect(asc.rows.map((r) => r.studentId)).toEqual(["s2", "s1"]);

    const desc = await service.build({ termId: "term-1", classLevelId: "level-jss1", sortBy: "position", sortDir: "desc" });
    expect(desc.rows.map((r) => r.studentId)).toEqual(["s1", "s2"]);
  });

  it("paginates with skip/take while total reflects the full scope, unaffected by the page size", async () => {
    prisma.classLevel.findUniqueOrThrow.mockResolvedValue(CLASS_LEVEL);
    prisma.classArm.findMany.mockResolvedValue([{ id: "arm-diamond", name: "Diamond" }]);
    prisma.studentProfile.findMany.mockResolvedValue([
      student("s1", "A001", "arm-diamond"),
      student("s2", "A002", "arm-diamond"),
      student("s3", "A003", "arm-diamond"),
    ]);
    prisma.subjectTermResult.findMany.mockResolvedValue([]);

    const page1 = await service.build({ termId: "term-1", classLevelId: "level-jss1", skip: 0, take: 2 });
    expect(page1.rows.map((r) => r.studentId)).toEqual(["s1", "s2"]);
    expect(page1.total).toBe(3);

    const page2 = await service.build({ termId: "term-1", classLevelId: "level-jss1", skip: 2, take: 2 });
    expect(page2.rows.map((r) => r.studentId)).toEqual(["s3"]);
    expect(page2.total).toBe(3);
  });

  it("computes position/ranking over the full scope even when a page only returns part of it", async () => {
    prisma.classLevel.findUniqueOrThrow.mockResolvedValue(CLASS_LEVEL);
    prisma.classArm.findMany.mockResolvedValue([{ id: "arm-diamond", name: "Diamond" }]);
    prisma.studentProfile.findMany.mockResolvedValue([
      student("s1", "A001", "arm-diamond"),
      student("s2", "A002", "arm-diamond"),
      student("s3", "A003", "arm-diamond"),
    ]);
    prisma.subjectTermResult.findMany.mockResolvedValue([
      { studentId: "s1", subjectId: "subj-math", totalScore: 90, grade: "A1" },
      { studentId: "s2", subjectId: "subj-math", totalScore: 70, grade: "A1" },
      { studentId: "s3", subjectId: "subj-math", totalScore: 50, grade: "B2" },
    ]);

    // Page 2 (skip=2, take=1) is just s3 — but s3's position must still be 3,
    // ranked against s1/s2 even though they aren't on this page.
    const page = await service.build({ termId: "term-1", classLevelId: "level-jss1", skip: 2, take: 1 });
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]!.subjects.find((s) => s.subjectId === "subj-math")).toMatchObject({ position: 3 });
  });

  it("returns an empty grid when the class level has no arms for this session", async () => {
    prisma.classLevel.findUniqueOrThrow.mockResolvedValue(CLASS_LEVEL);
    prisma.classArm.findMany.mockResolvedValue([]);

    const result = await service.build({ termId: "term-1", classLevelId: "level-jss1" });

    expect(result.rows).toEqual([]);
    expect(prisma.studentProfile.findMany).not.toHaveBeenCalled();
  });

  describe("SESSION mode (\"Overall\" — averaged across every term in the session)", () => {
    const SESSION = { id: "session-1", name: "2026/2027" };
    const TERM_1 = { id: "term-1", academicSessionId: "session-1" };
    const TERM_2 = { id: "term-2", academicSessionId: "session-1" };
    const TERM_3 = { id: "term-3", academicSessionId: "session-1" };

    beforeEach(() => {
      prisma.academicSession.findUniqueOrThrow.mockResolvedValue(SESSION);
      prisma.term.findMany.mockResolvedValue([TERM_1, TERM_2, TERM_3]);
      prisma.classLevel.findUniqueOrThrow.mockResolvedValue(CLASS_LEVEL);
      prisma.classArm.findMany.mockResolvedValue([{ id: "arm-diamond", name: "Diamond" }]);
    });

    it("queries every term in the session and scopes classArms by the session directly (mode/termId/periodLabel reflect SESSION)", async () => {
      prisma.studentProfile.findMany.mockResolvedValue([student("s1", "A001", "arm-diamond")]);
      prisma.subjectTermResult.findMany.mockResolvedValue([]);

      const result = await service.build({ academicSessionId: "session-1", classLevelId: "level-jss1" });

      expect(result.mode).toBe("SESSION");
      expect(result.termId).toBeNull();
      expect(result.academicSessionId).toBe("session-1");
      expect(result.periodLabel).toContain("2026/2027");
      expect(prisma.subjectTermResult.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ termId: { in: ["term-1", "term-2", "term-3"] } }) }),
      );
      expect(prisma.classArm.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { classLevelId: "level-jss1", academicSessionId: "session-1" } }),
      );
    });

    it("averages a subject's totals across only the terms that have a result, excluding a missing term entirely", async () => {
      prisma.studentProfile.findMany.mockResolvedValue([student("s1", "A001", "arm-diamond")]);
      prisma.subjectTermResult.findMany.mockResolvedValue([
        // Mathematics scored in term 1 and 3 only (term 2 missing — not a 0).
        { studentId: "s1", subjectId: "subj-math", termId: "term-1", totalScore: 80, grade: "A1" },
        { studentId: "s1", subjectId: "subj-math", termId: "term-3", totalScore: 60, grade: "B2" },
      ]);

      const result = await service.build({ academicSessionId: "session-1", classLevelId: "level-jss1" });

      const mathCell = result.rows[0]!.subjects.find((s) => s.subjectId === "subj-math")!;
      // (80 + 60) / 2 = 70 — not (80 + 0 + 60) / 3 (which would be 46.67, an F9).
      expect(mathCell.totalScore).toBe(70);
      expect(mathCell.grade).toBe("A1");
    });

    it("ranks the SESSION-mode averaged totals fresh, same as TERM mode", async () => {
      prisma.studentProfile.findMany.mockResolvedValue([
        student("s1", "A001", "arm-diamond"),
        student("s2", "A002", "arm-diamond"),
      ]);
      prisma.subjectTermResult.findMany.mockResolvedValue([
        { studentId: "s1", subjectId: "subj-math", termId: "term-1", totalScore: 90, grade: "A1" },
        { studentId: "s2", subjectId: "subj-math", termId: "term-1", totalScore: 60, grade: "B2" },
      ]);

      const result = await service.build({ academicSessionId: "session-1", classLevelId: "level-jss1" });

      const byId = (id: string) => result.rows.find((r) => r.studentId === id)!;
      expect(byId("s1").subjects.find((s) => s.subjectId === "subj-math")).toMatchObject({ totalScore: 90, position: 1 });
      expect(byId("s2").subjects.find((s) => s.subjectId === "subj-math")).toMatchObject({ totalScore: 60, position: 2 });
    });
  });
});
