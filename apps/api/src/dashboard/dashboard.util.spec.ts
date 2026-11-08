import { buildAssessmentProgress, buildIncomeReport, rankMostAbsentStaff, type AssessmentProgressInput } from "./dashboard.util";

describe("rankMostAbsentStaff", () => {
  const directory = new Map([
    ["staff-1", { employeeId: "EMP-1", firstName: "Ada", lastName: "Okoye" }],
    ["staff-2", { employeeId: "EMP-2", firstName: "Bola", lastName: "Adeyemi" }],
    ["staff-3", { employeeId: "EMP-3", firstName: "Chidi", lastName: "Eze" }],
  ]);

  it("ranks staff by absence count, worst first", () => {
    const records = [
      { personId: "staff-1", status: "ABSENT" as const },
      { personId: "staff-1", status: "ABSENT" as const },
      { personId: "staff-2", status: "ABSENT" as const },
      { personId: "staff-2", status: "ABSENT" as const },
      { personId: "staff-2", status: "ABSENT" as const },
      { personId: "staff-3", status: "PRESENT" as const },
    ];

    const ranked = rankMostAbsentStaff(records, directory, 5);

    expect(ranked.map((r) => r.staffId)).toEqual(["staff-2", "staff-1"]);
    expect(ranked[0]).toMatchObject({ staffId: "staff-2", employeeId: "EMP-2", firstName: "Bola", lastName: "Adeyemi", absent: 3 });
  });

  it("excludes staff with zero absences even if they have other statuses", () => {
    const records = [
      { personId: "staff-3", status: "PRESENT" as const },
      { personId: "staff-3", status: "LATE" as const },
    ];

    expect(rankMostAbsentStaff(records, directory, 5)).toEqual([]);
  });

  it("respects the limit", () => {
    const records = [
      { personId: "staff-1", status: "ABSENT" as const },
      { personId: "staff-2", status: "ABSENT" as const },
      { personId: "staff-2", status: "ABSENT" as const },
      { personId: "staff-3", status: "ABSENT" as const },
      { personId: "staff-3", status: "ABSENT" as const },
      { personId: "staff-3", status: "ABSENT" as const },
    ];

    const ranked = rankMostAbsentStaff(records, directory, 2);

    expect(ranked).toHaveLength(2);
    expect(ranked.map((r) => r.staffId)).toEqual(["staff-3", "staff-2"]);
  });

  it("falls back to null name fields for a staffId missing from the directory", () => {
    const ranked = rankMostAbsentStaff([{ personId: "unknown-staff", status: "ABSENT" as const }], directory, 5);

    expect(ranked[0]).toMatchObject({ staffId: "unknown-staff", employeeId: null, firstName: null, lastName: null, absent: 1 });
  });
});

describe("buildIncomeReport", () => {
  it("buckets payments by paidAt day and totals the grand sum/count", () => {
    const report = buildIncomeReport([
      { amount: 5000, paidAt: new Date("2026-03-01T09:00:00.000Z"), method: "CASH" as const, gatewayProvider: null },
      { amount: 2000, paidAt: new Date("2026-03-01T15:00:00.000Z"), method: "BANK_TRANSFER_MANUAL" as const, gatewayProvider: null },
      { amount: 3000, paidAt: new Date("2026-03-02T09:00:00.000Z"), method: "GATEWAY_CARD" as const, gatewayProvider: "PAYSTACK" as const },
    ]);

    expect(report.totalIncome).toBe(10000);
    expect(report.totalCount).toBe(3);
    expect(report.dailyIncome).toEqual([
      { date: "2026-03-01", total: 7000, count: 2 },
      { date: "2026-03-02", total: 3000, count: 1 },
    ]);
  });

  it("tallies subtotals by method, sorted highest total first", () => {
    const report = buildIncomeReport([
      { amount: 1000, paidAt: new Date("2026-03-01"), method: "CASH" as const, gatewayProvider: null },
      { amount: 5000, paidAt: new Date("2026-03-01"), method: "BANK_TRANSFER_MANUAL" as const, gatewayProvider: null },
      { amount: 2000, paidAt: new Date("2026-03-02"), method: "CASH" as const, gatewayProvider: null },
    ]);

    expect(report.byMethod).toEqual([
      { method: "BANK_TRANSFER_MANUAL", total: 5000, count: 1 },
      { method: "CASH", total: 3000, count: 2 },
    ]);
  });

  it("only tallies a gateway subtotal for payments that actually carry a gatewayProvider", () => {
    const report = buildIncomeReport([
      { amount: 4000, paidAt: new Date("2026-03-01"), method: "GATEWAY_CARD" as const, gatewayProvider: "MONNIFY" as const },
      { amount: 6000, paidAt: new Date("2026-03-01"), method: "GATEWAY_TRANSFER" as const, gatewayProvider: "PAYSTACK" as const },
      { amount: 1000, paidAt: new Date("2026-03-01"), method: "CASH" as const, gatewayProvider: null },
    ]);

    expect(report.byGateway).toEqual([
      { gatewayProvider: "PAYSTACK", total: 6000, count: 1 },
      { gatewayProvider: "MONNIFY", total: 4000, count: 1 },
    ]);
  });

  it("skips a payment with no paidAt rather than crashing on it", () => {
    const report = buildIncomeReport([
      { amount: 1000, paidAt: null, method: "CASH" as const, gatewayProvider: null },
      { amount: 2000, paidAt: new Date("2026-03-01"), method: "CASH" as const, gatewayProvider: null },
    ]);

    expect(report.totalIncome).toBe(2000);
    expect(report.totalCount).toBe(1);
  });

  it("returns zeroed totals and empty breakdowns for an empty date range", () => {
    expect(buildIncomeReport([])).toEqual({ totalIncome: 0, totalCount: 0, dailyIncome: [], byMethod: [], byGateway: [] });
  });
});

describe("buildAssessmentProgress", () => {
  function baseInput(overrides: Partial<AssessmentProgressInput> = {}): AssessmentProgressInput {
    return {
      classArms: [
        { id: "arm-jss1a", name: "A", classLevelId: "lvl-jss1", classLevel: { name: "JSS 1", order: 7, category: "JSS" } },
      ],
      studentCountByArm: new Map([["arm-jss1a", 3]]),
      components: [
        { id: "exam", type: "EXAM", name: "Exam", sequence: 1, status: "OPEN", classLevelCategory: "JSS" },
        { id: "ca1", type: "CA", name: "CA 1", sequence: 1, status: "CLOSED", classLevelCategory: "JSS" },
        { id: "nursery-ca", type: "CA", name: "CA 1", sequence: 1, status: "OPEN", classLevelCategory: "NURSERY" },
      ],
      classSubjects: [
        {
          classLevelCategory: "JSS",
          subject: { id: "maths", name: "Mathematics", isGroup: false, isActive: true, childSubjects: [] },
          levelStatuses: [],
          termStatuses: [],
        },
      ],
      enrollments: [
        { studentId: "s1", subjectId: "maths", classArmId: "arm-jss1a" },
        { studentId: "s2", subjectId: "maths", classArmId: "arm-jss1a" },
        { studentId: "s3", subjectId: "maths", classArmId: "arm-jss1a" },
      ],
      scoreCountByKey: new Map([
        ["arm-jss1a:maths:ca1", 3],
        ["arm-jss1a:maths:exam", 1],
      ]),
      comments: [],
      skillItems: [],
      skillRatings: [],
      assignments: [],
      ...overrides,
    };
  }

  it("counts score entries per component in CA → MID_TERM → EXAM order, only for the class's own category", () => {
    const [cls] = buildAssessmentProgress(baseInput());
    expect(cls!.subjects).toHaveLength(1);
    expect(cls!.subjects[0]).toMatchObject({ subjectName: "Mathematics", total: 3 });
    expect(cls!.subjects[0]!.components.map((c) => [c.componentId, c.completed])).toEqual([
      ["ca1", 3],
      ["exam", 1],
    ]);
  });

  it("flattens a group subject into its children, covering a group enrollment/assignment for each child", () => {
    const [cls] = buildAssessmentProgress(
      baseInput({
        classSubjects: [
          {
            classLevelCategory: "JSS",
            subject: {
              id: "bst",
              name: "Basic Science and Technology",
              isGroup: true,
              isActive: true,
              childSubjects: [
                { id: "bsci", name: "Basic Science", isActive: true },
                { id: "ict", name: "ICT", isActive: true },
                { id: "old", name: "Retired", isActive: false },
              ],
            },
            levelStatuses: [],
            termStatuses: [],
          },
        ],
        enrollments: [
          { studentId: "s1", subjectId: "bst", classArmId: "arm-jss1a" },
          { studentId: "s2", subjectId: "bst", classArmId: "arm-jss1a" },
        ],
        assignments: [
          { assignmentType: "SUBJECT_TEACHER", classArmId: "arm-jss1a", subjectId: "ict", staffId: "t1", staffName: "EZE CHIDI" },
        ],
      }),
    );
    expect(cls!.subjects.map((s) => [s.subjectName, s.total, s.teachers.map((t) => t.name)])).toEqual([
      ["Basic Science", 2, []],
      ["ICT", 2, ["EZE CHIDI"]],
    ]);
  });

  it("drops subjects disabled for the class level, disabled for the term, or with nobody enrolled", () => {
    const subject = (id: string) => ({ id, name: id, isGroup: false, isActive: true, childSubjects: [] });
    const [cls] = buildAssessmentProgress(
      baseInput({
        classSubjects: [
          { classLevelCategory: "JSS", subject: subject("level-off"), levelStatuses: [{ classLevelId: "lvl-jss1" }], termStatuses: [] },
          { classLevelCategory: "JSS", subject: subject("term-off"), levelStatuses: [], termStatuses: [{ subjectId: "term-off" }] },
          { classLevelCategory: "JSS", subject: subject("nobody"), levelStatuses: [], termStatuses: [] },
          { classLevelCategory: "JSS", subject: subject("other-level-off"), levelStatuses: [{ classLevelId: "lvl-jss2" }], termStatuses: [] },
        ],
        enrollments: ["level-off", "term-off", "other-level-off"].map((subjectId) => ({
          studentId: "s1",
          subjectId,
          classArmId: "arm-jss1a",
        })),
      }),
    );
    expect(cls!.subjects.map((s) => s.subjectId)).toEqual(["other-level-off"]);
  });

  it("only counts a student's skills as complete once every applicable item is rated", () => {
    const [cls] = buildAssessmentProgress(
      baseInput({
        skillItems: [
          { id: "neat", categories: [] },
          { id: "punctual", categories: ["JSS", "SSS"] },
          { id: "counting", categories: ["RECEPTION"] },
        ],
        skillRatings: [
          { studentId: "s1", classArmId: "arm-jss1a", skillAssessmentItemId: "neat" },
          { studentId: "s1", classArmId: "arm-jss1a", skillAssessmentItemId: "punctual" },
          { studentId: "s2", classArmId: "arm-jss1a", skillAssessmentItemId: "neat" },
        ],
      }),
    );
    expect(cls!.skills).toEqual({ completed: 1, total: 3 });
  });

  it("returns null skills when no item applies to the class's category", () => {
    const [cls] = buildAssessmentProgress(baseInput({ skillItems: [{ id: "counting", categories: ["RECEPTION"] }] }));
    expect(cls!.skills).toBeNull();
  });

  it("counts comments per type and attaches the class teacher and the section's principal-comment owner", () => {
    const [cls] = buildAssessmentProgress(
      baseInput({
        comments: [
          { studentId: "s1", classArmId: "arm-jss1a", commentType: "CLASS_TEACHER" },
          { studentId: "s2", classArmId: "arm-jss1a", commentType: "CLASS_TEACHER" },
          { studentId: "s1", classArmId: "arm-jss1a", commentType: "PRINCIPAL" },
        ],
        assignments: [
          { assignmentType: "CLASS_TEACHER", classArmId: "arm-jss1a", subjectId: null, staffId: "ct", staffName: "OKOYE ADA" },
          { assignmentType: "PRINCIPAL", classArmId: null, subjectId: null, staffId: "p", staffName: "ADEYEMI BOLA" },
          { assignmentType: "HEADTEACHER", classArmId: null, subjectId: null, staffId: "h", staffName: "NWOSU EMEKA" },
        ],
      }),
    );
    expect(cls!.classTeacherComments).toEqual({ completed: 2, total: 3 });
    expect(cls!.principalComments).toEqual({ completed: 1, total: 3 });
    expect(cls!.classTeachers.map((t) => t.name)).toEqual(["OKOYE ADA"]);
    expect(cls!.principalCommentOwners.map((t) => t.name)).toEqual(["ADEYEMI BOLA"]);
  });

  it("orders classes by class level order, then arm name", () => {
    const classes = buildAssessmentProgress(
      baseInput({
        classArms: [
          { id: "b", name: "B", classLevelId: "l7", classLevel: { name: "JSS 1", order: 7, category: "JSS" } },
          { id: "c", name: "A", classLevelId: "l8", classLevel: { name: "JSS 2", order: 8, category: "JSS" } },
          { id: "a", name: "A", classLevelId: "l7", classLevel: { name: "JSS 1", order: 7, category: "JSS" } },
        ],
      }),
    );
    expect(classes.map((c) => c.className)).toEqual(["JSS 1 A", "JSS 1 B", "JSS 2 A"]);
  });
});
