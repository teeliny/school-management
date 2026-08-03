import { AssessmentComponentStatus, ReportWindowStatus } from "@prisma/client";
import { isStructureComplete } from "@school/types";

export interface SweepableComponent {
  id: string;
  termId: string;
  classLevelId: string;
  status: AssessmentComponentStatus;
  maxScore: number;
  inputOpensAt: Date;
  inputClosesAt: Date;
  publishAt: Date;
}

export interface SweepTransition {
  componentId: string;
  nextStatus: AssessmentComponentStatus;
}

/**
 * PRD §3.6: "status transitions automatically off the three date fields...
 * but Admin can override any transition manually." Pure and Prisma-free so
 * it's directly unit-testable as a date-driven state machine, independent of
 * BullMQ scheduling or DB access (mirrors timetable-slot.ts's overlaps()
 * extraction). A DRAFT component past its open date only advances if the
 * whole (termId, classLevelId) group's components sum to 100 — otherwise it
 * stays DRAFT until Admin completes the structure or forces it open.
 */
export function computeSweepTransitions(components: SweepableComponent[], now: Date): SweepTransition[] {
  const groups = new Map<string, SweepableComponent[]>();
  for (const component of components) {
    const key = `${component.termId}:${component.classLevelId}`;
    const group = groups.get(key) ?? [];
    group.push(component);
    groups.set(key, group);
  }

  const transitions: SweepTransition[] = [];

  for (const group of groups.values()) {
    const structureComplete = isStructureComplete(group.map((c) => c.maxScore));

    for (const component of group) {
      if (component.status === AssessmentComponentStatus.DRAFT) {
        if (now >= component.inputOpensAt && structureComplete) {
          transitions.push({ componentId: component.id, nextStatus: AssessmentComponentStatus.OPEN });
        }
      } else if (component.status === AssessmentComponentStatus.OPEN) {
        if (now >= component.inputClosesAt) {
          transitions.push({ componentId: component.id, nextStatus: AssessmentComponentStatus.CLOSED });
        }
      } else if (component.status === AssessmentComponentStatus.CLOSED) {
        if (now >= component.publishAt) {
          transitions.push({ componentId: component.id, nextStatus: AssessmentComponentStatus.PUBLISHED });
        }
      }
    }
  }

  return transitions;
}

export interface SweepableReportWindow {
  id: string;
  status: ReportWindowStatus;
  inputOpensAt: Date;
  inputClosesAt: Date;
}

export interface ReportWindowTransition {
  windowId: string;
  nextStatus: ReportWindowStatus;
}

/**
 * PRD §3.6: ReportWindow shares AssessmentComponent's "scheduled by default,
 * Admin override always available" shape, but its own state machine is
 * simpler — DRAFT→OPEN→CLOSED off two dates, no structure-completeness gate
 * (that rule is specific to AssessmentComponent's "must sum to 100" scoring
 * structure, not applicable here) and no PUBLISHED state.
 */
export function computeReportWindowTransitions(windows: SweepableReportWindow[], now: Date): ReportWindowTransition[] {
  const transitions: ReportWindowTransition[] = [];

  for (const window of windows) {
    if (window.status === ReportWindowStatus.DRAFT) {
      if (now >= window.inputOpensAt) {
        transitions.push({ windowId: window.id, nextStatus: ReportWindowStatus.OPEN });
      }
    } else if (window.status === ReportWindowStatus.OPEN) {
      if (now >= window.inputClosesAt) {
        transitions.push({ windowId: window.id, nextStatus: ReportWindowStatus.CLOSED });
      }
    }
  }

  return transitions;
}
