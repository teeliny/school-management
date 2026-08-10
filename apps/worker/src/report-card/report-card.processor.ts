import { Inject, Logger } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { AssessmentComponentType, EnrollmentStatus, ReportCommentType, TermReportCardStatus } from "@prisma/client";
import { findGradeScaleMatch, QUEUE_NAMES, type ReportCardGenerationJob } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";
import { STORAGE_ADAPTER, type StorageAdapter } from "../storage/storage-adapter";
import { SubjectTermResultService } from "../subject-term-result/subject-term-result.service";
import {
  buildFullTermContent,
  buildMidTermSnapshot,
  type FullTermOverallInput,
  type FullTermSkillRatingInput,
  type FullTermSubjectResultInput,
  type MidTermSubjectScoreInput,
} from "./report-card-content.util";
import { renderFullTermPdf, renderMidTermPdf } from "./report-card-pdf.util";

const SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

@Processor(QUEUE_NAMES.REPORT_CARD_GENERATION)
export class ReportCardProcessor extends WorkerHost {
  private readonly logger = new Logger(ReportCardProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subjectTermResults: SubjectTermResultService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {
    super();
  }

  async process(job: Job<ReportCardGenerationJob>): Promise<void> {
    const { studentId, termId, reportType } = job.data;

    if (reportType === "MID_TERM") {
      await this.generateMidTerm(studentId, termId);
    } else {
      await this.generateFullTerm(studentId, termId);
    }
  }

  /**
   * PRD §3.6 (design revised post-Phase-4): shows only the term's single
   * MID_TERM-type component's score per subject — not a cumulative CA+Mid-
   * Term subtotal, since CA scores are typically still OPEN at this point
   * in the term. Each subject's score is normalized to a percentage of that
   * component's maxScore and graded via GradeScale, same as a
   * SubjectTermResult — giving each subject (and the report overall, minus
   * a remark) a grade too now.
   *
   * A grouped subject gets one row (not one per child), scored as the
   * SubjectGroupWeight-weighted average of whichever children have a
   * mid-term score — same shape full-term's per-component breakdown and
   * SubjectTermResultService.aggregateForClassCategoryTerm both use, kept
   * consistent here rather than flattening groups into their children.
   */
  private async generateMidTerm(studentId: string, termId: string): Promise<void> {
    const [student, term] = await Promise.all([
      this.prisma.studentProfile.findUniqueOrThrow({
        where: { id: studentId },
        include: { user: true, currentClass: { include: { classLevel: true } } },
      }),
      this.prisma.term.findUniqueOrThrow({ where: { id: termId } }),
    ]);

    if (!student.currentClass) {
      throw new Error(`Student ${studentId} has no current class — cannot generate a mid-term report`);
    }
    const classArmId = student.currentClass.id;
    const classLevelCategory = student.currentClass.classLevel.category;

    const midTermComponent = await this.prisma.assessmentComponent.findFirst({
      where: { termId, classLevelCategory, type: AssessmentComponentType.MID_TERM },
    });
    if (!midTermComponent) {
      throw new Error(`No MID_TERM component found for term ${termId}, class group ${classLevelCategory}`);
    }

    const enrollments = await this.prisma.studentSubjectEnrollment.findMany({
      where: { studentId, classArmId, termId, status: EnrollmentStatus.ACTIVE },
      include: { subject: { include: { childSubjects: true } } },
    });

    // Scores are entered per child subject under the shared mid-term
    // component (PRD §3.6), same as any ordinary subject — fetch for every
    // group's children plus every standalone enrollment's own subject.
    const scoreSubjectIds = enrollments.flatMap((enrollment) =>
      enrollment.subject.isGroup ? enrollment.subject.childSubjects.map((child) => child.id) : [enrollment.subjectId],
    );
    const scores = await this.prisma.scoreEntry.findMany({
      where: { studentId, assessmentComponentId: midTermComponent.id, subjectId: { in: scoreSubjectIds } },
      select: { subjectId: true, score: true },
    });
    const scoreFor = (subjectId: string) => scores.find((s) => s.subjectId === subjectId);

    const groupSubjectIds = [...new Set(enrollments.filter((e) => e.subject.isGroup).map((e) => e.subjectId))];
    const groupWeights =
      groupSubjectIds.length > 0
        ? await this.prisma.subjectGroupWeight.findMany({ where: { groupSubjectId: { in: groupSubjectIds } } })
        : [];
    const disabledChildrenByGroup = new Map<string, Set<string>>();
    for (const groupId of groupSubjectIds) {
      disabledChildrenByGroup.set(
        groupId,
        await this.subjectTermResults.disabledChildSubjectIds(groupId, classLevelCategory, termId),
      );
    }

    const maxScore = Number(midTermComponent.maxScore);
    const subjects: MidTermSubjectScoreInput[] = enrollments.map((enrollment) => {
      if (!enrollment.subject.isGroup) {
        const entry = scoreFor(enrollment.subjectId);
        return {
          subjectId: enrollment.subjectId,
          subjectName: enrollment.subject.name,
          score: entry ? Number(entry.score) : null,
          maxScore,
        };
      }

      // A child disabled for this term is excluded from the weight sum
      // entirely rather than counted as 0, same as the full-term/
      // SubjectTermResult weighting.
      const weights = groupWeights.filter((w) => w.groupSubjectId === enrollment.subjectId);
      const disabledChildIds = disabledChildrenByGroup.get(enrollment.subjectId) ?? new Set<string>();
      let weightedSum = 0;
      let weightTotal = 0;
      for (const weight of weights) {
        if (disabledChildIds.has(weight.childSubjectId)) continue;
        const entry = scoreFor(weight.childSubjectId);
        if (!entry) continue;
        weightedSum += Number(entry.score) * Number(weight.weight);
        weightTotal += Number(weight.weight);
      }
      return {
        subjectId: enrollment.subjectId,
        subjectName: enrollment.subject.name,
        score: weightTotal > 0 ? weightedSum / weightTotal : null,
        maxScore,
      };
    });

    const gradeScales = await this.subjectTermResults.fetchGradeScaleRows();
    const snapshot = buildMidTermSnapshot(subjects, gradeScales);

    const generatedAt = new Date();
    const school = await this.fetchSchoolHeaderMeta();

    const pdfBuffer = await renderMidTermPdf(snapshot, {
      studentName: `${student.user.firstName} ${student.user.lastName}`,
      admissionNumber: student.admissionNumber,
      termName: term.name,
      schoolName: school.name,
      schoolAddress: school.address,
      logoBuffer: school.logoBuffer,
      generatedAt,
    });

    const key = `report-cards/${studentId}/${termId}/mid-term.pdf`;
    await this.storage.put(key, pdfBuffer, "application/pdf");
    const pdfUrl = await this.storage.getSignedUrl(key, SIGNED_URL_TTL_SECONDS);

    await this.prisma.termReportCard.update({
      where: { studentId_termId_reportType: { studentId, termId, reportType: "MID_TERM" } },
      data: {
        pdfUrl,
        scoresSnapshot: snapshot as never,
        status: TermReportCardStatus.READY,
        generatedAt,
        overallScore: snapshot.overallPercentage,
        overallGrade: snapshot.overallGrade,
        // No overallRemark for MID_TERM, by design (PRD §3.6).
        needsRegeneration: false,
        staleReason: null,
        staleSince: null,
      },
    });

    this.logger.log(`Generated mid-term report card for student ${studentId}, term ${termId}`);
  }

  /**
   * PRD FR4.7: generation always renders whatever exists — the completeness
   * gate (SubjectTermResult for every enrolled subject, both skill
   * categories, both comments) is checked at publish time by
   * TermReportCardService (api), not here.
   *
   * PRD §3.6 (added post-Phase-4): also shows a per-component score
   * breakdown (not just the SubjectTermResult total), additive prior-term
   * total columns, and — on whichever term is chronologically last in the
   * academic session — grades per subject (and overall) on the average of
   * that subject's totals across every term in the session, via
   * SubjectTermResultService.computeAnnualSummary, instead of this term's
   * total alone.
   */
  private async generateFullTerm(studentId: string, termId: string): Promise<void> {
    const [student, term] = await Promise.all([
      this.prisma.studentProfile.findUniqueOrThrow({
        where: { id: studentId },
        include: { user: true, currentClass: { include: { classLevel: true } } },
      }),
      this.prisma.term.findUniqueOrThrow({ where: { id: termId } }),
    ]);

    if (!student.currentClass) {
      throw new Error(`Student ${studentId} has no current class — cannot generate a full-term report`);
    }
    const classLevelCategory = student.currentClass.classLevel.category;

    const sessionTerms = await this.prisma.term.findMany({
      where: { academicSessionId: term.academicSessionId },
      orderBy: { startDate: "asc" },
    });
    const currentIndex = sessionTerms.findIndex((t) => t.id === termId);
    const priorTerms = currentIndex > 0 ? sessionTerms.slice(0, currentIndex) : [];

    const components = await this.prisma.assessmentComponent.findMany({
      where: { termId, classLevelCategory },
      orderBy: [{ type: "asc" }, { sequence: "asc" }],
    });

    const results = await this.prisma.subjectTermResult.findMany({
      where: { studentId, termId },
      include: { subject: true },
    });

    // A grouped subject's children each carry their own SubjectTermResult
    // row too (SubjectTermResultService.aggregateForClassCategoryTerm, "for
    // transparency") but only the parent — never its children — belongs on
    // the report itself (PRD §3.3: a group's children aren't independently
    // reportable, same rule computeAnnualSummary already applies via this
    // exact `parentSubjectId === null` filter).
    const reportableResults = results.filter((r) => r.subject.parentSubjectId === null);

    const scoreEntries = await this.prisma.scoreEntry.findMany({
      where: { studentId, assessmentComponentId: { in: components.map((c) => c.id) } },
      select: { subjectId: true, assessmentComponentId: true, score: true },
    });

    const groupSubjectIds = [...new Set(reportableResults.filter((r) => r.subject.isGroup).map((r) => r.subjectId))];
    const groupWeights = await this.prisma.subjectGroupWeight.findMany({
      where: { groupSubjectId: { in: groupSubjectIds } },
      select: { groupSubjectId: true, childSubjectId: true, weight: true },
    });
    // A child disabled for this term is excluded from every component's
    // weighted figure below, not just left to fall out via "no entry" —
    // same ClassSubjectTermStatus-aware exclusion
    // SubjectTermResultService.aggregateForClassCategoryTerm applies to the
    // total, kept consistent here for the per-component breakdown.
    const disabledChildrenByGroup = new Map<string, Set<string>>();
    for (const groupId of groupSubjectIds) {
      disabledChildrenByGroup.set(
        groupId,
        await this.subjectTermResults.disabledChildSubjectIds(groupId, classLevelCategory, termId),
      );
    }

    // Class-wide low/high context per subject — every other student's
    // SubjectTermResult sharing the same (subjectId, classArmId, termId),
    // the exact population SubjectTermResultService.assignPositions already
    // ranks this student's position against.
    const classmateResults =
      reportableResults.length > 0
        ? await this.prisma.subjectTermResult.findMany({
            where: { termId, OR: reportableResults.map((r) => ({ subjectId: r.subjectId, classArmId: r.classArmId })) },
            select: { subjectId: true, classArmId: true, totalScore: true },
          })
        : [];

    const priorResults =
      priorTerms.length > 0
        ? await this.prisma.subjectTermResult.findMany({
            where: { studentId, termId: { in: priorTerms.map((t) => t.id) } },
          })
        : [];

    const annual = await this.subjectTermResults.computeAnnualSummary(studentId, termId);

    const ratings = await this.prisma.skillRating.findMany({
      where: { studentId, termId },
      include: { skillAssessmentItem: true },
    });

    const [classTeacherComment, principalComment] = await Promise.all([
      this.prisma.reportComment.findFirst({
        where: { studentId, termId, commentType: ReportCommentType.CLASS_TEACHER },
      }),
      this.prisma.reportComment.findFirst({
        where: { studentId, termId, commentType: ReportCommentType.PRINCIPAL },
      }),
    ]);

    const subjects: FullTermSubjectResultInput[] = reportableResults.map((result) => {
      const componentScores = components.map((component) => {
        if (result.subject.isGroup) {
          // Group subjects are never directly scored (ScoreEntryService
          // backstops it) — a parent's per-component figure is the
          // weight-averaged score of whichever children have a score for
          // that component, same weighting SubjectGroupWeight already
          // applies to the total. A child with nothing entered yet is
          // excluded from the average rather than dragging it toward zero,
          // and a child disabled for this term is excluded outright
          // regardless of any (pre-disable) entries it might still carry.
          const childWeights = groupWeights.filter((w) => w.groupSubjectId === result.subjectId);
          const disabledChildIds = disabledChildrenByGroup.get(result.subjectId);
          let weightedSum = 0;
          let weightTotal = 0;
          for (const { childSubjectId, weight } of childWeights) {
            if (disabledChildIds?.has(childSubjectId)) continue;
            const entry = scoreEntries.find(
              (s) => s.subjectId === childSubjectId && s.assessmentComponentId === component.id,
            );
            if (entry) {
              weightedSum += Number(entry.score) * Number(weight);
              weightTotal += Number(weight);
            }
          }
          return {
            name: component.name,
            score: weightTotal > 0 ? weightedSum / weightTotal : null,
            maxScore: Number(component.maxScore),
          };
        }
        const entry = scoreEntries.find(
          (s) => s.subjectId === result.subjectId && s.assessmentComponentId === component.id,
        );
        return { name: component.name, score: entry ? Number(entry.score) : null, maxScore: Number(component.maxScore) };
      });
      const priorTotals = priorTerms.map((priorTerm) => {
        const prior = priorResults.find((p) => p.subjectId === result.subjectId && p.termId === priorTerm.id);
        return { termName: priorTerm.name, total: prior ? Number(prior.totalScore) : null };
      });
      const annualSubject = annual?.subjects.find((s) => s.subjectId === result.subjectId);
      const classmateTotals = classmateResults
        .filter((c) => c.subjectId === result.subjectId && c.classArmId === result.classArmId)
        .map((c) => Number(c.totalScore));
      return {
        subjectName: result.subject.name,
        components: componentScores,
        totalScore: Number(result.totalScore),
        classLowScore: classmateTotals.length > 0 ? Math.min(...classmateTotals) : null,
        classHighScore: classmateTotals.length > 0 ? Math.max(...classmateTotals) : null,
        priorTerms: priorTotals,
        grade: annualSubject ? annualSubject.grade : result.grade,
        remark: annualSubject ? annualSubject.remark : result.remark,
        position: annualSubject ? annualSubject.position : result.position,
      };
    });

    let overall: FullTermOverallInput;
    if (annual) {
      overall = { isAnnual: true, average: annual.overallAverage, grade: annual.overallGrade, remark: annual.overallRemark };
    } else {
      const totals = reportableResults.map((r) => Number(r.totalScore));
      const average = totals.length > 0 ? totals.reduce((sum, value) => sum + value, 0) / totals.length : null;
      const gradeScales = await this.subjectTermResults.fetchGradeScaleRows();
      const { grade, remark } = average !== null ? findGradeScaleMatch(gradeScales, average) : { grade: null, remark: null };
      overall = { isAnnual: false, average, grade, remark };
    }

    const content = buildFullTermContent(
      subjects,
      components.map((c) => ({ name: c.name, maxScore: Number(c.maxScore) })),
      overall,
      ratings.map(
        (r): FullTermSkillRatingInput => ({
          category: r.skillAssessmentItem.category,
          name: r.skillAssessmentItem.name,
          rating: r.rating,
        }),
      ),
      { classTeacherComment: classTeacherComment?.comment ?? null, principalComment: principalComment?.comment ?? null },
    );

    const generatedAt = new Date();
    const school = await this.fetchSchoolHeaderMeta();

    const pdfBuffer = await renderFullTermPdf(content, {
      studentName: `${student.user.firstName} ${student.user.lastName}`,
      admissionNumber: student.admissionNumber,
      termName: term.name,
      schoolName: school.name,
      schoolAddress: school.address,
      logoBuffer: school.logoBuffer,
      generatedAt,
    });

    const key = `report-cards/${studentId}/${termId}/full-term.pdf`;
    await this.storage.put(key, pdfBuffer, "application/pdf");
    const pdfUrl = await this.storage.getSignedUrl(key, SIGNED_URL_TTL_SECONDS);

    await this.prisma.termReportCard.update({
      where: { studentId_termId_reportType: { studentId, termId, reportType: "FULL_TERM" } },
      data: {
        pdfUrl,
        status: TermReportCardStatus.READY,
        generatedAt,
        overallScore: overall.average,
        overallGrade: overall.grade,
        overallRemark: overall.remark,
        needsRegeneration: false,
        staleReason: null,
        staleSince: null,
      },
    });

    this.logger.log(`Generated full-term report card for student ${studentId}, term ${termId}`);
  }

  /**
   * PDF header (both report types, per PRD §3.6): school name/address come
   * straight from the SchoolProfile singleton; the logo is fetched over the
   * network since SchoolProfile only stores a URL, not bytes. A missing or
   * unreachable logo degrades to no logo rather than failing generation —
   * it's a decorative header element, not required content.
   */
  private async fetchSchoolHeaderMeta(): Promise<{
    name: string;
    address: string | null;
    logoBuffer: Buffer | null;
  }> {
    const school = await this.prisma.schoolProfile.findFirstOrThrow();

    let logoBuffer: Buffer | null = null;
    if (school.logoUrl) {
      try {
        const response = await fetch(school.logoUrl);
        if (response.ok) {
          logoBuffer = Buffer.from(await response.arrayBuffer());
        } else {
          this.logger.warn(`School logo fetch returned ${response.status}, omitting from report card`);
        }
      } catch (error) {
        this.logger.warn(`Failed to fetch school logo, omitting from report card: ${error}`);
      }
    }

    return { name: school.name, address: school.address, logoBuffer };
  }
}
