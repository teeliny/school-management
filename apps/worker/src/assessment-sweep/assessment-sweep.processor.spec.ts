import { AssessmentComponentStatus, AssessmentComponentType, ReportWindowStatus } from "@prisma/client";
import { AssessmentSweepProcessor } from "./assessment-sweep.processor";

function buildPrismaMock() {
  return {
    assessmentComponent: { findMany: jest.fn(), update: jest.fn() },
    term: { findUniqueOrThrow: jest.fn() },
    classArm: { findMany: jest.fn() },
    studentSubjectEnrollment: { findMany: jest.fn() },
    termReportCard: { upsert: jest.fn() },
    reportWindow: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
  };
}

function buildQueueMock() {
  return { add: jest.fn() };
}

const PAST = new Date("2020-01-01T00:00:00Z");

function buildComponent(overrides: Record<string, unknown> = {}) {
  return {
    id: "comp-1",
    termId: "term-1",
    classLevelId: "level-1",
    type: AssessmentComponentType.CA,
    status: AssessmentComponentStatus.OPEN,
    maxScore: 20,
    inputOpensAt: PAST,
    inputClosesAt: PAST,
    publishAt: PAST,
    ...overrides,
  };
}

describe("AssessmentSweepProcessor.process (orchestration)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let subjectTermResults: { aggregateForClassLevelTerm: jest.Mock };
  let sweepQueue: ReturnType<typeof buildQueueMock>;
  let reportCardQueue: ReturnType<typeof buildQueueMock>;
  let processor: AssessmentSweepProcessor;

  beforeEach(() => {
    prisma = buildPrismaMock();
    subjectTermResults = { aggregateForClassLevelTerm: jest.fn() };
    sweepQueue = buildQueueMock();
    reportCardQueue = buildQueueMock();
    processor = new AssessmentSweepProcessor(
      prisma as never,
      subjectTermResults as never,
      sweepQueue as never,
      reportCardQueue as never,
    );
  });

  it("triggers SubjectTermResult aggregation once every component in the group is closed/published", async () => {
    // Two OPEN components past their close date; once both close this tick,
    // the group is fully closed/published.
    prisma.assessmentComponent.findMany
      .mockResolvedValueOnce([
        buildComponent({ id: "ca", type: AssessmentComponentType.CA }),
        buildComponent({ id: "exam", type: AssessmentComponentType.EXAM }),
      ])
      // Re-fetch inside the "is the group fully closed" check.
      .mockResolvedValueOnce([
        buildComponent({ id: "ca", type: AssessmentComponentType.CA, status: AssessmentComponentStatus.CLOSED }),
        buildComponent({ id: "exam", type: AssessmentComponentType.EXAM, status: AssessmentComponentStatus.CLOSED }),
      ]);

    await processor.process({} as never);

    expect(prisma.assessmentComponent.update).toHaveBeenCalledTimes(2);
    expect(subjectTermResults.aggregateForClassLevelTerm).toHaveBeenCalledWith("term-1", "level-1");
  });

  it("does not aggregate while a sibling component in the group is still open", async () => {
    prisma.assessmentComponent.findMany
      .mockResolvedValueOnce([buildComponent({ id: "ca", type: AssessmentComponentType.CA })])
      // Re-fetch shows a sibling still OPEN (not queried past its close date this tick).
      .mockResolvedValueOnce([
        buildComponent({ id: "ca", type: AssessmentComponentType.CA, status: AssessmentComponentStatus.CLOSED }),
        buildComponent({
          id: "exam",
          type: AssessmentComponentType.EXAM,
          status: AssessmentComponentStatus.OPEN,
          inputClosesAt: new Date("2099-01-01"),
        }),
      ]);

    await processor.process({} as never);

    expect(subjectTermResults.aggregateForClassLevelTerm).not.toHaveBeenCalled();
  });

  it("enqueues a MID_TERM report-card job per enrolled student when the MID_TERM component closes", async () => {
    prisma.assessmentComponent.findMany
      .mockResolvedValueOnce([buildComponent({ id: "midterm", type: AssessmentComponentType.MID_TERM })])
      .mockResolvedValueOnce([
        buildComponent({ id: "midterm", type: AssessmentComponentType.MID_TERM, status: AssessmentComponentStatus.CLOSED }),
      ]);
    prisma.term.findUniqueOrThrow.mockResolvedValue({ id: "term-1", academicSessionId: "session-1" });
    prisma.classArm.findMany.mockResolvedValue([{ id: "arm-1" }]);
    prisma.studentSubjectEnrollment.findMany.mockResolvedValue([{ studentId: "student-1" }, { studentId: "student-2" }]);

    await processor.process({} as never);

    expect(prisma.termReportCard.upsert).toHaveBeenCalledTimes(2);
    expect(reportCardQueue.add).toHaveBeenCalledWith("generate", {
      studentId: "student-1",
      termId: "term-1",
      reportType: "MID_TERM",
    });
    expect(reportCardQueue.add).toHaveBeenCalledWith("generate", {
      studentId: "student-2",
      termId: "term-1",
      reportType: "MID_TERM",
    });
  });

  it("does not enqueue report cards for a CA component closing (only MID_TERM triggers it)", async () => {
    prisma.assessmentComponent.findMany
      .mockResolvedValueOnce([buildComponent({ id: "ca", type: AssessmentComponentType.CA })])
      .mockResolvedValueOnce([
        buildComponent({ id: "ca", type: AssessmentComponentType.CA, status: AssessmentComponentStatus.CLOSED }),
      ]);

    await processor.process({} as never);

    expect(reportCardQueue.add).not.toHaveBeenCalled();
  });

  it("also transitions a due ReportWindow in the same tick", async () => {
    prisma.assessmentComponent.findMany.mockResolvedValue([]);
    prisma.reportWindow.findMany.mockResolvedValue([
      { id: "window-1", status: ReportWindowStatus.DRAFT, inputOpensAt: PAST, inputClosesAt: PAST },
    ]);

    await processor.process({} as never);

    expect(prisma.reportWindow.update).toHaveBeenCalledWith({
      where: { id: "window-1" },
      data: { status: ReportWindowStatus.OPEN },
    });
  });

  it("does not touch a ReportWindow that isn't due yet", async () => {
    prisma.assessmentComponent.findMany.mockResolvedValue([]);
    prisma.reportWindow.findMany.mockResolvedValue([
      { id: "window-1", status: ReportWindowStatus.DRAFT, inputOpensAt: new Date("2099-01-01"), inputClosesAt: new Date("2099-06-01") },
    ]);

    await processor.process({} as never);

    expect(prisma.reportWindow.update).not.toHaveBeenCalled();
  });
});
