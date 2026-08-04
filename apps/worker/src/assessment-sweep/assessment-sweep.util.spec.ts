import { AssessmentComponentStatus, ReportWindowStatus } from "@prisma/client";
import {
  computeReportWindowTransitions,
  computeSweepTransitions,
  type SweepableComponent,
  type SweepableReportWindow,
} from "./assessment-sweep.util";

const NOW = new Date("2026-03-01T00:00:00Z");
const PAST = new Date("2026-01-01T00:00:00Z");
const FUTURE = new Date("2026-12-01T00:00:00Z");

function buildComponent(overrides: Partial<SweepableComponent> = {}): SweepableComponent {
  return {
    id: "comp-1",
    termId: "term-1",
    classLevelId: "level-1",
    status: AssessmentComponentStatus.DRAFT,
    maxScore: 20,
    inputOpensAt: PAST,
    inputClosesAt: PAST,
    publishAt: PAST,
    ...overrides,
  };
}

describe("computeSweepTransitions (PRD §3.6 date-driven state machine)", () => {
  it("opens a DRAFT component past its open date when the group's structure sums to 100", () => {
    const components = [
      buildComponent({ id: "ca1", maxScore: 20, inputOpensAt: PAST }),
      buildComponent({ id: "ca2", maxScore: 20, inputOpensAt: PAST }),
      buildComponent({ id: "exam", maxScore: 60, inputOpensAt: PAST }),
    ];

    const transitions = computeSweepTransitions(components, NOW);

    expect(transitions).toEqual(
      expect.arrayContaining([
        { componentId: "ca1", nextStatus: AssessmentComponentStatus.OPEN },
        { componentId: "ca2", nextStatus: AssessmentComponentStatus.OPEN },
        { componentId: "exam", nextStatus: AssessmentComponentStatus.OPEN },
      ]),
    );
    expect(transitions).toHaveLength(3);
  });

  it("leaves a DRAFT component past its open date untouched when the group's structure is incomplete", () => {
    const components = [
      buildComponent({ id: "ca1", maxScore: 20, inputOpensAt: PAST }),
      buildComponent({ id: "exam", maxScore: 60, inputOpensAt: PAST }),
    ];

    const transitions = computeSweepTransitions(components, NOW);

    expect(transitions).toEqual([]);
  });

  it("does not open a DRAFT component before its open date, even with a complete structure", () => {
    const components = [
      buildComponent({ id: "ca1", maxScore: 40, inputOpensAt: FUTURE }),
      buildComponent({ id: "exam", maxScore: 60, inputOpensAt: FUTURE }),
    ];

    const transitions = computeSweepTransitions(components, NOW);

    expect(transitions).toEqual([]);
  });

  it("closes an OPEN component past its close date", () => {
    const components = [
      buildComponent({ id: "ca1", status: AssessmentComponentStatus.OPEN, inputClosesAt: PAST }),
    ];

    expect(computeSweepTransitions(components, NOW)).toEqual([
      { componentId: "ca1", nextStatus: AssessmentComponentStatus.CLOSED },
    ]);
  });

  it("leaves an OPEN component alone before its close date", () => {
    const components = [
      buildComponent({ id: "ca1", status: AssessmentComponentStatus.OPEN, inputClosesAt: FUTURE }),
    ];

    expect(computeSweepTransitions(components, NOW)).toEqual([]);
  });

  it("publishes a CLOSED component past its publish date", () => {
    const components = [
      buildComponent({ id: "ca1", status: AssessmentComponentStatus.CLOSED, publishAt: PAST }),
    ];

    expect(computeSweepTransitions(components, NOW)).toEqual([
      { componentId: "ca1", nextStatus: AssessmentComponentStatus.PUBLISHED },
    ]);
  });

  it("leaves a CLOSED component alone before its publish date", () => {
    const components = [
      buildComponent({ id: "ca1", status: AssessmentComponentStatus.CLOSED, publishAt: FUTURE }),
    ];

    expect(computeSweepTransitions(components, NOW)).toEqual([]);
  });

  it("never opens a DRAFT component with no inputOpensAt (a freshly carried-forward component), even with a complete structure", () => {
    const components = [
      buildComponent({ id: "ca1", maxScore: 40, inputOpensAt: null }),
      buildComponent({ id: "exam", maxScore: 60, inputOpensAt: null }),
    ];

    expect(computeSweepTransitions(components, NOW)).toEqual([]);
  });

  it("never closes an OPEN component with no inputClosesAt", () => {
    const components = [
      buildComponent({ id: "ca1", status: AssessmentComponentStatus.OPEN, inputClosesAt: null }),
    ];

    expect(computeSweepTransitions(components, NOW)).toEqual([]);
  });

  it("never publishes a CLOSED component with no publishAt", () => {
    const components = [
      buildComponent({ id: "ca1", status: AssessmentComponentStatus.CLOSED, publishAt: null }),
    ];

    expect(computeSweepTransitions(components, NOW)).toEqual([]);
  });

  it("evaluates structure-completeness per (termId, classLevelId) group independently", () => {
    const components = [
      // Complete group — should open.
      buildComponent({ id: "a", termId: "term-1", classLevelId: "level-1", maxScore: 100, inputOpensAt: PAST }),
      // Incomplete group — should not open, even though it shares a termId.
      buildComponent({ id: "b", termId: "term-1", classLevelId: "level-2", maxScore: 40, inputOpensAt: PAST }),
    ];

    expect(computeSweepTransitions(components, NOW)).toEqual([
      { componentId: "a", nextStatus: AssessmentComponentStatus.OPEN },
    ]);
  });
});

function buildWindow(overrides: Partial<SweepableReportWindow> = {}): SweepableReportWindow {
  return {
    id: "window-1",
    status: ReportWindowStatus.DRAFT,
    inputOpensAt: PAST,
    inputClosesAt: PAST,
    ...overrides,
  };
}

describe("computeReportWindowTransitions (PRD §3.6 — simpler than AssessmentComponent, no structure gate/PUBLISHED state)", () => {
  it("opens a DRAFT window past its open date, unconditionally (no structure-completeness gate)", () => {
    const result = computeReportWindowTransitions([buildWindow({ inputOpensAt: PAST })], NOW);
    expect(result).toEqual([{ windowId: "window-1", nextStatus: ReportWindowStatus.OPEN }]);
  });

  it("does not open a DRAFT window before its open date", () => {
    const result = computeReportWindowTransitions([buildWindow({ inputOpensAt: FUTURE })], NOW);
    expect(result).toEqual([]);
  });

  it("closes an OPEN window past its close date", () => {
    const result = computeReportWindowTransitions(
      [buildWindow({ status: ReportWindowStatus.OPEN, inputClosesAt: PAST })],
      NOW,
    );
    expect(result).toEqual([{ windowId: "window-1", nextStatus: ReportWindowStatus.CLOSED }]);
  });

  it("leaves an OPEN window alone before its close date", () => {
    const result = computeReportWindowTransitions(
      [buildWindow({ status: ReportWindowStatus.OPEN, inputClosesAt: FUTURE })],
      NOW,
    );
    expect(result).toEqual([]);
  });

  it("never transitions a CLOSED window (no PUBLISHED state to advance to)", () => {
    const result = computeReportWindowTransitions(
      [buildWindow({ status: ReportWindowStatus.CLOSED, inputClosesAt: PAST })],
      NOW,
    );
    expect(result).toEqual([]);
  });
});
