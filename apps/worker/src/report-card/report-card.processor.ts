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
   */
  private async generateMidTerm(studentId: string, termId: string): Promise<void> {
    const [student, term] = await Promise.all([
      this.prisma.studentProfile.findUniqueOrThrow({
        where: { id: studentId },
        include: { user: true, currentClass: true },
      }),
      this.prisma.term.findUniqueOrThrow({ where: { id: termId } }),
    ]);

    if (!student.currentClass) {
      throw new Error(`Student ${studentId} has no current class — cannot generate a mid-term report`);
    }
    const classArmId = student.currentClass.id;
    const classLevelId = student.currentClass.classLevelId;

    const midTermComponent = await this.prisma.assessmentComponent.findFirst({
      where: { termId, classLevelId, type: AssessmentComponentType.MID_TERM },
    });
    if (!midTermComponent) {
      throw new Error(`No MID_TERM component found for term ${termId}, class level ${classLevelId}`);
    }

    const enrollments = await this.prisma.studentSubjectEnrollment.findMany({
      where: { studentId, classArmId, termId, status: EnrollmentStatus.ACTIVE },
      include: { subject: { include: { childSubjects: true } } },
    });

    // A grouped subject's children (not the parent) carry the actual scores
    // (PRD §3.6) — expand each group enrollment into its children for
    // display, same as the full-term breakdown.
    const subjectRefs = enrollments.flatMap((enrollment) =>
      enrollment.subject.isGroup
        ? enrollment.subject.childSubjects.map((child) => ({ subjectId: child.id, subjectName: child.name }))
        : [{ subjectId: enrollment.subjectId, subjectName: enrollment.subject.name }],
    );

    const scores = await this.prisma.scoreEntry.findMany({
      where: {
        studentId,
        assessmentComponentId: midTermComponent.id,
        subjectId: { in: subjectRefs.map((s) => s.subjectId) },
      },
      select: { subjectId: true, score: true },
    });

    const maxScore = Number(midTermComponent.maxScore);
    const subjects: MidTermSubjectScoreInput[] = subjectRefs.map((ref) => {
      const entry = scores.find((s) => s.subjectId === ref.subjectId);
      return {
        subjectId: ref.subjectId,
        subjectName: ref.subjectName,
        score: entry ? Number(entry.score) : null,
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
        include: { user: true, currentClass: true },
      }),
      this.prisma.term.findUniqueOrThrow({ where: { id: termId } }),
    ]);

    if (!student.currentClass) {
      throw new Error(`Student ${studentId} has no current class — cannot generate a full-term report`);
    }
    const classLevelId = student.currentClass.classLevelId;

    const sessionTerms = await this.prisma.term.findMany({
      where: { academicSessionId: term.academicSessionId },
      orderBy: { startDate: "asc" },
    });
    const currentIndex = sessionTerms.findIndex((t) => t.id === termId);
    const priorTerms = currentIndex > 0 ? sessionTerms.slice(0, currentIndex) : [];

    const components = await this.prisma.assessmentComponent.findMany({
      where: { termId, classLevelId },
      orderBy: [{ type: "asc" }, { sequence: "asc" }],
    });

    const results = await this.prisma.subjectTermResult.findMany({
      where: { studentId, termId },
      include: { subject: true },
    });

    const scoreEntries = await this.prisma.scoreEntry.findMany({
      where: { studentId, assessmentComponentId: { in: components.map((c) => c.id) } },
      select: { subjectId: true, assessmentComponentId: true, score: true },
    });

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

    const subjects: FullTermSubjectResultInput[] = results.map((result) => {
      const componentScores = components.map((component) => {
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
      return {
        subjectName: result.subject.name,
        components: componentScores,
        totalScore: Number(result.totalScore),
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
      const reportable = results.filter((r) => r.subject.parentSubjectId === null);
      const totals = reportable.map((r) => Number(r.totalScore));
      const average = totals.length > 0 ? totals.reduce((sum, value) => sum + value, 0) / totals.length : null;
      const gradeScales = await this.subjectTermResults.fetchGradeScaleRows();
      const { grade, remark } = average !== null ? findGradeScaleMatch(gradeScales, average) : { grade: null, remark: null };
      overall = { isAnnual: false, average, grade, remark };
    }

    const content = buildFullTermContent(
      subjects,
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
