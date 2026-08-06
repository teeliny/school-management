import { Logger, OnModuleInit } from "@nestjs/common";
import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job, Queue } from "bullmq";
import {
  AssessmentComponentStatus,
  AssessmentComponentType,
  ClassLevelCategory,
  EnrollmentStatus,
  ReportWindowStatus,
  TermReportCardStatus,
  TermReportCardType,
} from "@prisma/client";
import { QUEUE_NAMES, type ReportCardGenerationJob } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";
import { SubjectTermResultService } from "../subject-term-result/subject-term-result.service";
import { computeReportWindowTransitions, computeSweepTransitions } from "./assessment-sweep.util";

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const REPEATABLE_JOB_ID = "assessment-schedule-sweep-repeatable";

@Processor(QUEUE_NAMES.ASSESSMENT_SCHEDULE_SWEEP)
export class AssessmentSweepProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(AssessmentSweepProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subjectTermResults: SubjectTermResultService,
    @InjectQueue(QUEUE_NAMES.ASSESSMENT_SCHEDULE_SWEEP) private readonly sweepQueue: Queue,
    @InjectQueue(QUEUE_NAMES.REPORT_CARD_GENERATION) private readonly reportCardQueue: Queue<ReportCardGenerationJob>,
  ) {
    super();
  }

  // BullMQ dedupes a repeatable job by its (name, repeat pattern, jobId), so
  // re-adding this on every worker boot is idempotent, not a growing pile of
  // schedules.
  async onModuleInit() {
    await this.sweepQueue.add(
      "sweep",
      {},
      { repeat: { every: SWEEP_INTERVAL_MS }, jobId: REPEATABLE_JOB_ID },
    );
  }

  async process(_job: Job): Promise<void> {
    const components = await this.prisma.assessmentComponent.findMany({
      where: { status: { in: [AssessmentComponentStatus.DRAFT, AssessmentComponentStatus.OPEN, AssessmentComponentStatus.CLOSED] } },
    });

    const transitions = computeSweepTransitions(
      components.map((c) => ({ ...c, maxScore: Number(c.maxScore) })),
      new Date(),
    );

    // (termId, classLevelCategory) groups touched by a transition this tick
    // — candidates for "is the whole group closed now" (FR4.4 aggregation)
    // and, separately, groups whose just-closed component was the MID_TERM
    // one (this phase's mid-term report trigger). Keyed by group key -> the
    // actual ids, so no re-parsing of a joined string is needed later.
    //
    // aggregationCandidateGroups is populated on BOTH a CLOSED and a
    // PUBLISHED transition, not just CLOSED — a group's last remaining
    // not-yet-terminal component can complete the "every component is
    // CLOSED or PUBLISHED" set via either kind of transition (e.g. its
    // siblings already sit at PUBLISHED from an earlier tick and this
    // component's own CLOSED→PUBLISHED step is what completes the set).
    // Gating only on CLOSED missed that case: the group would sit fully
    // closed/published forever with no tick ever re-checking it, so
    // SubjectTermResult never got populated even though nothing had failed.
    interface Group {
      termId: string;
      classLevelCategory: ClassLevelCategory;
    }
    const aggregationCandidateGroups = new Map<string, Group>();
    const midTermClosedGroups = new Map<string, Group>();

    for (const transition of transitions) {
      const component = components.find((c) => c.id === transition.componentId);
      await this.prisma.assessmentComponent.update({
        where: { id: transition.componentId },
        data: { status: transition.nextStatus },
      });

      if (!component) continue;

      if (
        transition.nextStatus === AssessmentComponentStatus.CLOSED ||
        transition.nextStatus === AssessmentComponentStatus.PUBLISHED
      ) {
        const group: Group = { termId: component.termId, classLevelCategory: component.classLevelCategory };
        const key = `${group.termId}:${group.classLevelCategory}`;
        aggregationCandidateGroups.set(key, group);
      }

      if (transition.nextStatus === AssessmentComponentStatus.CLOSED && component.type === AssessmentComponentType.MID_TERM) {
        const group: Group = { termId: component.termId, classLevelCategory: component.classLevelCategory };
        const key = `${group.termId}:${group.classLevelCategory}`;
        midTermClosedGroups.set(key, group);
      }
    }

    for (const { termId, classLevelCategory } of aggregationCandidateGroups.values()) {
      const groupComponents = await this.prisma.assessmentComponent.findMany({
        where: { termId, classLevelCategory },
      });
      const allClosedOrPublished = groupComponents.every(
        (c) => c.status === AssessmentComponentStatus.CLOSED || c.status === AssessmentComponentStatus.PUBLISHED,
      );
      if (allClosedOrPublished) {
        await this.subjectTermResults.aggregateForClassCategoryTerm(termId, classLevelCategory);
      }
    }

    for (const { termId, classLevelCategory } of midTermClosedGroups.values()) {
      await this.enqueueMidTermReports(termId, classLevelCategory);
    }

    const reportWindows = await this.prisma.reportWindow.findMany({
      where: { status: { in: [ReportWindowStatus.DRAFT, ReportWindowStatus.OPEN] } },
    });
    const windowTransitions = computeReportWindowTransitions(reportWindows, new Date());
    for (const transition of windowTransitions) {
      await this.prisma.reportWindow.update({
        where: { id: transition.windowId },
        data: { status: transition.nextStatus },
      });
    }

    if (transitions.length > 0 || windowTransitions.length > 0) {
      this.logger.log(
        `Sweep transitioned ${transitions.length} assessment component(s), ${windowTransitions.length} report window(s)`,
      );
    }
  }

  private async enqueueMidTermReports(termId: string, classLevelCategory: ClassLevelCategory): Promise<void> {
    const term = await this.prisma.term.findUniqueOrThrow({ where: { id: termId } });
    const classArms = await this.prisma.classArm.findMany({
      where: { classLevel: { category: classLevelCategory }, academicSessionId: term.academicSessionId },
      select: { id: true },
    });

    const enrollments = await this.prisma.studentSubjectEnrollment.findMany({
      where: { classArmId: { in: classArms.map((a) => a.id) }, termId, status: EnrollmentStatus.ACTIVE },
      select: { studentId: true },
      distinct: ["studentId"],
    });

    for (const { studentId } of enrollments) {
      await this.prisma.termReportCard.upsert({
        where: { studentId_termId_reportType: { studentId, termId, reportType: TermReportCardType.MID_TERM } },
        create: { studentId, termId, reportType: TermReportCardType.MID_TERM, status: TermReportCardStatus.GENERATING },
        update: { status: TermReportCardStatus.GENERATING },
      });
      await this.reportCardQueue.add("generate", { studentId, termId, reportType: "MID_TERM" });
    }
  }
}
