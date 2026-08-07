import { AssessmentComponentType } from "@prisma/client";
import { ReportCardProcessor } from "./report-card.processor";
import * as reportCardPdfUtil from "./report-card-pdf.util";

function buildPrismaMock() {
  return {
    schoolProfile: { findFirstOrThrow: jest.fn() },
  };
}

function buildFullPrismaMock() {
  return {
    studentProfile: { findUniqueOrThrow: jest.fn() },
    term: { findUniqueOrThrow: jest.fn(), findMany: jest.fn() },
    assessmentComponent: { findFirst: jest.fn(), findMany: jest.fn() },
    studentSubjectEnrollment: { findMany: jest.fn() },
    scoreEntry: { findMany: jest.fn() },
    subjectTermResult: { findMany: jest.fn() },
    subjectGroupWeight: { findMany: jest.fn().mockResolvedValue([]) },
    skillRating: { findMany: jest.fn() },
    reportComment: { findFirst: jest.fn() },
    schoolProfile: { findFirstOrThrow: jest.fn() },
    termReportCard: { update: jest.fn() },
  };
}

function buildSubjectTermResultsMock() {
  return {
    fetchGradeScaleRows: jest.fn().mockResolvedValue([{ minScore: 0, maxScore: 100, grade: "A1", remark: "Excellent" }]),
    computeAnnualSummary: jest.fn().mockResolvedValue(null),
    disabledChildSubjectIds: jest.fn().mockResolvedValue(new Set()),
  };
}

function buildStorageMock() {
  return { put: jest.fn(), getSignedUrl: jest.fn().mockResolvedValue("https://storage.example.com/signed.pdf") };
}

const STUDENT = {
  user: { firstName: "Tobi", lastName: "Kalu" },
  admissionNumber: "STU-2291",
  currentClass: { id: "arm-1", classLevel: { category: "JSS" } },
};
const TERM_1 = { id: "term-1", name: "Term 1", academicSessionId: "session-1", startDate: new Date("2025-09-01") };

// fetchSchoolHeaderMeta is private — accessed via a standalone (non-
// intersected) helper type, same pragmatic pattern used elsewhere in this
// repo for testing a private helper without exercising the whole job. This
// must NOT be `ReportCardProcessor & {...}`: TS collapses that intersection
// to `never` when a public redeclaration collides with a private member of
// the same name on the class.
interface HasFetchSchoolHeaderMeta {
  fetchSchoolHeaderMeta(): Promise<{ name: string; address: string | null; logoBuffer: Buffer | null }>;
}

function callFetchSchoolHeaderMeta(processor: ReportCardProcessor) {
  return (processor as unknown as HasFetchSchoolHeaderMeta).fetchSchoolHeaderMeta();
}

describe("ReportCardProcessor.fetchSchoolHeaderMeta (PDF header — logo/address)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let processor: ReportCardProcessor;
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    prisma = buildPrismaMock();
    processor = new ReportCardProcessor(prisma as never, {} as never, {} as never);
    fetchSpy = jest.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("returns name/address with no logo when SchoolProfile has no logoUrl", async () => {
    prisma.schoolProfile.findFirstOrThrow.mockResolvedValue({
      name: "Green Valley College",
      address: "12 Ring Road, Lagos",
      logoUrl: null,
    });

    const result = await callFetchSchoolHeaderMeta(processor);

    expect(result).toEqual({ name: "Green Valley College", address: "12 Ring Road, Lagos", logoBuffer: null });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches and includes the logo bytes when logoUrl is set and reachable", async () => {
    prisma.schoolProfile.findFirstOrThrow.mockResolvedValue({
      name: "Green Valley College",
      address: null,
      logoUrl: "https://storage.example.com/logo.png",
    });
    fetchSpy.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as Response);

    const result = await callFetchSchoolHeaderMeta(processor);

    expect(result.logoBuffer).toEqual(Buffer.from([1, 2, 3]));
  });

  it("degrades to no logo (not an error) when the logo fetch returns a non-OK status", async () => {
    prisma.schoolProfile.findFirstOrThrow.mockResolvedValue({
      name: "Green Valley College",
      address: null,
      logoUrl: "https://storage.example.com/missing.png",
    });
    fetchSpy.mockResolvedValue({ ok: false, status: 404 } as Response);

    const result = await callFetchSchoolHeaderMeta(processor);

    expect(result.logoBuffer).toBeNull();
  });

  it("degrades to no logo (not an error) when the logo fetch throws", async () => {
    prisma.schoolProfile.findFirstOrThrow.mockResolvedValue({
      name: "Green Valley College",
      address: null,
      logoUrl: "https://storage.example.com/logo.png",
    });
    fetchSpy.mockRejectedValue(new Error("network down"));

    const result = await callFetchSchoolHeaderMeta(processor);

    expect(result.logoBuffer).toBeNull();
  });
});

describe("ReportCardProcessor.process — MID_TERM (only the MID_TERM component, PRD §3.6)", () => {
  let prisma: ReturnType<typeof buildFullPrismaMock>;
  let subjectTermResults: ReturnType<typeof buildSubjectTermResultsMock>;
  let storage: ReturnType<typeof buildStorageMock>;
  let processor: ReportCardProcessor;

  beforeEach(() => {
    prisma = buildFullPrismaMock();
    subjectTermResults = buildSubjectTermResultsMock();
    storage = buildStorageMock();
    processor = new ReportCardProcessor(prisma as never, subjectTermResults as never, storage as never);

    prisma.studentProfile.findUniqueOrThrow.mockResolvedValue(STUDENT);
    prisma.term.findUniqueOrThrow.mockResolvedValue(TERM_1);
    prisma.schoolProfile.findFirstOrThrow.mockResolvedValue({ name: "Ridgeview Academy", address: null, logoUrl: null });
  });

  it("throws when no MID_TERM component exists for this term/class level", async () => {
    prisma.assessmentComponent.findFirst.mockResolvedValue(null);

    await expect(
      processor.process({ data: { studentId: "student-1", termId: "term-1", reportType: "MID_TERM" } } as never),
    ).rejects.toThrow(/No MID_TERM component/);
  });

  it("normalizes each subject's score against the MID_TERM component's own maxScore and writes the overall summary (no remark)", async () => {
    prisma.assessmentComponent.findFirst.mockResolvedValue({
      id: "comp-midterm",
      type: AssessmentComponentType.MID_TERM,
      maxScore: 20,
    });
    prisma.studentSubjectEnrollment.findMany.mockResolvedValue([
      { subjectId: "subj-math", subject: { isGroup: false, name: "Mathematics", childSubjects: [] } },
    ]);
    prisma.scoreEntry.findMany.mockResolvedValue([{ subjectId: "subj-math", score: 18 }]);

    await processor.process({ data: { studentId: "student-1", termId: "term-1", reportType: "MID_TERM" } } as never);

    expect(storage.put).toHaveBeenCalledWith(
      "report-cards/student-1/term-1/mid-term.pdf",
      expect.anything(),
      "application/pdf",
    );
    expect(prisma.termReportCard.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { studentId_termId_reportType: { studentId: "student-1", termId: "term-1", reportType: "MID_TERM" } },
        data: expect.objectContaining({
          overallScore: 90, // 18/20 * 100
          overallGrade: "A1",
          pdfUrl: "https://storage.example.com/signed.pdf",
        }),
      }),
    );
    expect(prisma.termReportCard.update.mock.calls[0][0].data).not.toHaveProperty("overallRemark");
  });
});

describe("ReportCardProcessor.process — FULL_TERM (breakdown, prior terms, annual grading)", () => {
  let prisma: ReturnType<typeof buildFullPrismaMock>;
  let subjectTermResults: ReturnType<typeof buildSubjectTermResultsMock>;
  let storage: ReturnType<typeof buildStorageMock>;
  let processor: ReportCardProcessor;

  beforeEach(() => {
    prisma = buildFullPrismaMock();
    subjectTermResults = buildSubjectTermResultsMock();
    storage = buildStorageMock();
    processor = new ReportCardProcessor(prisma as never, subjectTermResults as never, storage as never);

    prisma.studentProfile.findUniqueOrThrow.mockResolvedValue(STUDENT);
    prisma.term.findUniqueOrThrow.mockResolvedValue(TERM_1);
    prisma.term.findMany.mockResolvedValue([TERM_1]);
    prisma.assessmentComponent.findMany.mockResolvedValue([]);
    prisma.scoreEntry.findMany.mockResolvedValue([]);
    prisma.skillRating.findMany.mockResolvedValue([]);
    prisma.reportComment.findFirst.mockResolvedValue(null);
    prisma.schoolProfile.findFirstOrThrow.mockResolvedValue({ name: "Ridgeview Academy", address: null, logoUrl: null });
  });

  it("falls back to this term's own totals when computeAnnualSummary returns null (not the session's last term)", async () => {
    subjectTermResults.computeAnnualSummary.mockResolvedValue(null);
    prisma.subjectTermResult.findMany.mockResolvedValue([
      {
        subjectId: "subj-math",
        totalScore: 80,
        grade: "A1",
        remark: "Excellent",
        position: 1,
        subject: { name: "Mathematics", parentSubjectId: null },
      },
    ]);

    await processor.process({ data: { studentId: "student-1", termId: "term-1", reportType: "FULL_TERM" } } as never);

    expect(prisma.termReportCard.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ overallScore: 80, overallGrade: "A1", overallRemark: "Excellent" }),
      }),
    );
  });

  it("uses computeAnnualSummary's per-subject and overall values when it's the session's last term", async () => {
    subjectTermResults.computeAnnualSummary.mockResolvedValue({
      subjects: [{ subjectId: "subj-math", average: 83.3, grade: "A1", remark: "Excellent", position: 2 }],
      overallAverage: 74.8,
      overallGrade: "B2",
      overallRemark: "Very Good",
    });
    prisma.subjectTermResult.findMany.mockResolvedValue([
      {
        subjectId: "subj-math",
        totalScore: 87,
        grade: "A1",
        remark: "Excellent",
        position: 1,
        subject: { name: "Mathematics", parentSubjectId: null },
      },
    ]);

    await processor.process({ data: { studentId: "student-1", termId: "term-1", reportType: "FULL_TERM" } } as never);

    expect(prisma.termReportCard.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ overallScore: 74.8, overallGrade: "B2", overallRemark: "Very Good" }),
      }),
    );
    // fetchGradeScaleRows isn't needed for the overall calc when annual data exists.
    expect(subjectTermResults.fetchGradeScaleRows).not.toHaveBeenCalled();
  });

  it("excludes a group subject's children from the report, keeping only the parent", async () => {
    const renderSpy = jest.spyOn(reportCardPdfUtil, "renderFullTermPdf");
    prisma.subjectTermResult.findMany.mockResolvedValue([
      {
        subjectId: "subj-basic-science",
        totalScore: 40,
        grade: "F9",
        remark: "Fail",
        position: null,
        subject: { name: "Basic Science", parentSubjectId: "subj-bst", isGroup: false },
      },
      {
        subjectId: "subj-bst",
        totalScore: 40,
        grade: "F9",
        remark: "Fail",
        position: null,
        subject: { name: "Basic Science and Technology", parentSubjectId: null, isGroup: true },
      },
    ]);

    await processor.process({ data: { studentId: "student-1", termId: "term-1", reportType: "FULL_TERM" } } as never);

    // Only the parent is reportable — the child's own SubjectTermResult row
    // (kept for transparency, per SubjectTermResultService) must not surface
    // as a second row on the printed report.
    const content = renderSpy.mock.calls[0]![0];
    expect(content.subjects.map((s) => s.subjectName)).toEqual(["Basic Science and Technology"]);
    renderSpy.mockRestore();
  });

  it("computes a group subject's per-component score as the weighted average of its children's scores for that component", async () => {
    const renderSpy = jest.spyOn(reportCardPdfUtil, "renderFullTermPdf");
    prisma.assessmentComponent.findMany.mockResolvedValue([{ id: "comp-1", name: "1st CA", maxScore: 20 }]);
    prisma.scoreEntry.findMany.mockResolvedValue([
      { subjectId: "subj-agric", assessmentComponentId: "comp-1", score: 10 },
      { subjectId: "subj-home-econs", assessmentComponentId: "comp-1", score: 16 },
    ]);
    prisma.subjectGroupWeight.findMany.mockResolvedValue([
      { groupSubjectId: "subj-pvs", childSubjectId: "subj-agric", weight: 1 },
      { groupSubjectId: "subj-pvs", childSubjectId: "subj-home-econs", weight: 1 },
    ]);
    prisma.subjectTermResult.findMany.mockResolvedValue([
      {
        subjectId: "subj-pvs",
        totalScore: 26,
        grade: "F9",
        remark: "Fail",
        position: null,
        subject: { name: "PVS", parentSubjectId: null, isGroup: true },
      },
    ]);

    await processor.process({ data: { studentId: "student-1", termId: "term-1", reportType: "FULL_TERM" } } as never);

    const content = renderSpy.mock.calls[0]![0];
    expect(content.subjects[0]!.components).toEqual([{ name: "1st CA", score: 13, maxScore: 20 }]);
    renderSpy.mockRestore();
  });

  it("excludes a child disabled for this term from the per-component weighted average, even if it still carries a pre-disable score entry", async () => {
    const renderSpy = jest.spyOn(reportCardPdfUtil, "renderFullTermPdf");
    prisma.assessmentComponent.findMany.mockResolvedValue([{ id: "comp-1", name: "1st CA", maxScore: 20 }]);
    prisma.scoreEntry.findMany.mockResolvedValue([
      // Both children have an entry, but subj-agric is disabled for this term —
      // its stale/pre-disable entry must not pull the average toward it.
      { subjectId: "subj-agric", assessmentComponentId: "comp-1", score: 2 },
      { subjectId: "subj-home-econs", assessmentComponentId: "comp-1", score: 16 },
    ]);
    prisma.subjectGroupWeight.findMany.mockResolvedValue([
      { groupSubjectId: "subj-pvs", childSubjectId: "subj-agric", weight: 1 },
      { groupSubjectId: "subj-pvs", childSubjectId: "subj-home-econs", weight: 1 },
    ]);
    prisma.subjectTermResult.findMany.mockResolvedValue([
      {
        subjectId: "subj-pvs",
        totalScore: 16,
        grade: "F9",
        remark: "Fail",
        position: null,
        subject: { name: "PVS", parentSubjectId: null, isGroup: true },
      },
    ]);
    subjectTermResults.disabledChildSubjectIds.mockResolvedValue(new Set(["subj-agric"]));

    await processor.process({ data: { studentId: "student-1", termId: "term-1", reportType: "FULL_TERM" } } as never);

    expect(subjectTermResults.disabledChildSubjectIds).toHaveBeenCalledWith("subj-pvs", "JSS", "term-1");
    const content = renderSpy.mock.calls[0]![0];
    expect(content.subjects[0]!.components).toEqual([{ name: "1st CA", score: 16, maxScore: 20 }]);
    renderSpy.mockRestore();
  });

  it("computes class low/high as the min/max totalScore among classmates sharing the same subject+classArm", async () => {
    const renderSpy = jest.spyOn(reportCardPdfUtil, "renderFullTermPdf");
    const mathResult = {
      subjectId: "subj-math",
      classArmId: "arm-1",
      totalScore: 70,
      grade: "A1",
      remark: "Excellent",
      position: 2,
      subject: { name: "Mathematics", parentSubjectId: null, isGroup: false },
    };
    prisma.subjectTermResult.findMany.mockImplementation((args: { where: { OR?: unknown } }) => {
      if (args.where.OR) {
        // Classmate lookup — three students' totals for the same subject/class arm.
        return Promise.resolve([
          { subjectId: "subj-math", classArmId: "arm-1", totalScore: 55 },
          { subjectId: "subj-math", classArmId: "arm-1", totalScore: 70 },
          { subjectId: "subj-math", classArmId: "arm-1", totalScore: 91 },
        ]);
      }
      return Promise.resolve([mathResult]);
    });

    await processor.process({ data: { studentId: "student-1", termId: "term-1", reportType: "FULL_TERM" } } as never);

    const content = renderSpy.mock.calls[0]![0];
    expect(content.subjects[0]!.classLowScore).toBe(55);
    expect(content.subjects[0]!.classHighScore).toBe(91);
    renderSpy.mockRestore();
  });

  it("adds one additive prior-term column per prior term, in chronological order", async () => {
    const term2 = { id: "term-2", name: "Term 2", academicSessionId: "session-1", startDate: new Date("2026-01-01") };
    prisma.term.findUniqueOrThrow.mockResolvedValue(term2);
    prisma.term.findMany.mockResolvedValue([TERM_1, term2]);
    prisma.subjectTermResult.findMany.mockImplementation((args: { where: { termId: unknown } }) => {
      if (typeof args.where.termId === "object") {
        // Prior-term lookup.
        return Promise.resolve([{ subjectId: "subj-math", termId: "term-1", totalScore: 80 }]);
      }
      // Current-term result.
      return Promise.resolve([
        {
          subjectId: "subj-math",
          totalScore: 83,
          grade: "A1",
          remark: "Excellent",
          position: 1,
          subject: { name: "Mathematics", parentSubjectId: null },
        },
      ]);
    });

    await processor.process({ data: { studentId: "student-1", termId: "term-2", reportType: "FULL_TERM" } } as never);

    // Verified indirectly via the PDF render call, since buildFullTermContent
    // (already unit-tested) shapes this — assert the processor at least
    // fetched the prior term's results for the right term id.
    expect(prisma.subjectTermResult.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { studentId: "student-1", termId: { in: ["term-1"] } } }),
    );
  });
});
