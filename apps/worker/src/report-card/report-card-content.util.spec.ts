import { buildFullTermContent, buildMidTermSnapshot } from "./report-card-content.util";

const GRADE_SCALES = [
  { minScore: 70, maxScore: 100, grade: "A1", remark: "Excellent" },
  { minScore: 50, maxScore: 69.99, grade: "B2", remark: "Very Good" },
  { minScore: 0, maxScore: 49.99, grade: "F9", remark: "Fail" },
];

describe("buildMidTermSnapshot (mid-term report content assembly — MID_TERM component only, per PRD §3.6)", () => {
  it("normalizes a subject's raw score to a percentage of maxScore and grades it", () => {
    const snapshot = buildMidTermSnapshot(
      [{ subjectId: "subj-1", subjectName: "Mathematics", score: 18, maxScore: 20 }],
      GRADE_SCALES,
    );

    expect(snapshot.subjects).toEqual([
      {
        subjectId: "subj-1",
        subjectName: "Mathematics",
        score: 18,
        maxScore: 20,
        percentage: 90,
        grade: "A1",
        remark: "Excellent",
      },
    ]);
  });

  it("records a null percentage/grade/remark (not zero) for a subject not yet scored", () => {
    const snapshot = buildMidTermSnapshot(
      [{ subjectId: "subj-1", subjectName: "Mathematics", score: null, maxScore: 20 }],
      GRADE_SCALES,
    );

    expect(snapshot.subjects[0]).toMatchObject({ percentage: null, grade: null, remark: null });
  });

  it("computes the overall percentage as the mean of the subjects' percentages, and grades it", () => {
    const snapshot = buildMidTermSnapshot(
      [
        { subjectId: "subj-1", subjectName: "Mathematics", score: 18, maxScore: 20 }, // 90%
        { subjectId: "subj-2", subjectName: "English", score: 12, maxScore: 20 }, // 60%
      ],
      GRADE_SCALES,
    );

    expect(snapshot.overallPercentage).toBe(75);
    expect(snapshot.overallGrade).toBe("A1");
    expect(snapshot).not.toHaveProperty("overallRemark");
  });

  it("excludes not-yet-scored subjects from the overall percentage, and returns null if none are scored", () => {
    const snapshot = buildMidTermSnapshot(
      [
        { subjectId: "subj-1", subjectName: "Mathematics", score: 18, maxScore: 20 },
        { subjectId: "subj-2", subjectName: "English", score: null, maxScore: 20 },
      ],
      GRADE_SCALES,
    );
    expect(snapshot.overallPercentage).toBe(90);

    const allUnscored = buildMidTermSnapshot(
      [{ subjectId: "subj-1", subjectName: "Mathematics", score: null, maxScore: 20 }],
      GRADE_SCALES,
    );
    expect(allUnscored.overallPercentage).toBeNull();
    expect(allUnscored.overallGrade).toBeNull();
  });
});

describe("buildFullTermContent (full-term report content assembly)", () => {
  const NO_OVERALL = { isAnnual: false, average: null, grade: null, remark: null };

  function buildSubject(overrides: Partial<Parameters<typeof buildFullTermContent>[0][number]> = {}) {
    return {
      subjectName: "Mathematics",
      components: [{ name: "1st CA", score: 17, maxScore: 20 }],
      totalScore: 87,
      classLowScore: 40,
      classHighScore: 87,
      priorTerms: [],
      grade: "A1",
      remark: "Excellent",
      position: 1,
      ...overrides,
    };
  }

  it("sorts subjects alphabetically by name", () => {
    const content = buildFullTermContent(
      [buildSubject({ subjectName: "Mathematics" }), buildSubject({ subjectName: "English" })],
      [{ name: "1st CA", maxScore: 20 }],
      NO_OVERALL,
      [],
      { classTeacherComment: null, principalComment: null },
    );

    expect(content.subjects.map((s) => s.subjectName)).toEqual(["English", "Mathematics"]);
  });

  it("carries the components through for the caller to use as column headers, and sums their maxScore into totalObtainable", () => {
    const content = buildFullTermContent(
      [buildSubject()],
      [
        { name: "1st CA", maxScore: 20 },
        { name: "2nd CA", maxScore: 20 },
        { name: "Exam", maxScore: 60 },
      ],
      NO_OVERALL,
      [],
      { classTeacherComment: null, principalComment: null },
    );

    expect(content.components).toEqual([
      { name: "1st CA", maxScore: 20 },
      { name: "2nd CA", maxScore: 20 },
      { name: "Exam", maxScore: 60 },
    ]);
    expect(content.totalObtainable).toBe(100);
  });

  it("passes each subject's component breakdown, total, class low/high, prior-term columns, grade, remark and position through unchanged", () => {
    const content = buildFullTermContent(
      [
        buildSubject({
          components: [
            { name: "1st CA", score: 17, maxScore: 20 },
            { name: "2nd CA", score: 18, maxScore: 20 },
            { name: "Exam", score: 52, maxScore: 60 },
          ],
          totalScore: 87,
          classLowScore: 40,
          classHighScore: 91,
          priorTerms: [
            { termName: "Term 1", total: 80 },
            { termName: "Term 2", total: 83 },
          ],
        }),
      ],
      [
        { name: "1st CA", maxScore: 20 },
        { name: "2nd CA", maxScore: 20 },
        { name: "Exam", maxScore: 60 },
      ],
      NO_OVERALL,
      [],
      { classTeacherComment: null, principalComment: null },
    );

    expect(content.subjects[0]).toEqual({
      subjectName: "Mathematics",
      components: [
        { name: "1st CA", score: 17, maxScore: 20 },
        { name: "2nd CA", score: 18, maxScore: 20 },
        { name: "Exam", score: 52, maxScore: 60 },
      ],
      totalScore: 87,
      classLowScore: 40,
      classHighScore: 91,
      priorTerms: [
        { termName: "Term 1", total: 80 },
        { termName: "Term 2", total: 83 },
      ],
      grade: "A1",
      remark: "Excellent",
      position: 1,
    });
  });

  it("passes the overall summary through, including the isAnnual flag", () => {
    const content = buildFullTermContent(
      [buildSubject()],
      [{ name: "1st CA", maxScore: 20 }],
      { isAnnual: true, average: 83.3, grade: "A1", remark: "Excellent" },
      [],
      { classTeacherComment: null, principalComment: null },
    );

    expect(content.isAnnual).toBe(true);
    expect(content.overallAverage).toBe(83.3);
    expect(content.overallGrade).toBe("A1");
    expect(content.overallRemark).toBe("Excellent");
  });

  it("splits skill ratings into PSYCHOMOTOR and AFFECTIVE_COGNITIVE buckets", () => {
    const content = buildFullTermContent(
      [],
      [],
      NO_OVERALL,
      [
        { category: "PSYCHOMOTOR", name: "Handwriting", rating: "GOOD" },
        { category: "AFFECTIVE_COGNITIVE", name: "Punctuality", rating: "EXCELLENT" },
      ],
      { classTeacherComment: null, principalComment: null },
    );

    expect(content.psychomotorSkills).toEqual([{ category: "PSYCHOMOTOR", name: "Handwriting", rating: "GOOD" }]);
    expect(content.affectiveCognitiveSkills).toEqual([
      { category: "AFFECTIVE_COGNITIVE", name: "Punctuality", rating: "EXCELLENT" },
    ]);
  });

  it("passes the two required comments through unchanged", () => {
    const content = buildFullTermContent([], [], NO_OVERALL, [], {
      classTeacherComment: "Well done this term.",
      principalComment: "Keep it up.",
    });

    expect(content.classTeacherComment).toBe("Well done this term.");
    expect(content.principalComment).toBe("Keep it up.");
  });

  it("passes through null comments when a required piece is missing (generation isn't gated)", () => {
    const content = buildFullTermContent([], [], NO_OVERALL, [], { classTeacherComment: null, principalComment: null });

    expect(content.classTeacherComment).toBeNull();
    expect(content.principalComment).toBeNull();
  });
});
