import { Injectable } from "@nestjs/common";
import { ClassLevelCategory, EnrollmentStatus } from "@prisma/client";
import { findGradeScaleMatch } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";
import { assignPositions } from "./position-ranking.util";

export interface AnnualSubjectSummary {
  subjectId: string;
  average: number;
  grade: string | null;
  remark: string | null;
  position: number | null;
}

export interface AnnualSummary {
  subjects: AnnualSubjectSummary[];
  overallAverage: number;
  overallGrade: string | null;
  overallRemark: string | null;
}

@Injectable()
export class SubjectTermResultService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * PRD §3.6/FR4.4: sums each student's ScoreEntry rows across every
   * AssessmentComponent for this (termId, classLevelCategory) into a
   * SubjectTermResult per subject, graded via GradeScale. Only the parent
   * subject of a grouped subject carries a StudentSubjectEnrollment row
   * (PRD §3.3), but scores are entered per child (PRD §3.6) under the same
   * shared components as any ordinary subject — so each child is summed the
   * same way a normal subject is, gets its own SubjectTermResult row for
   * transparency, and the parent's result is the SubjectGroupWeight-weighted
   * average of its children's totals (normalized by the actual weight sum,
   * not assumed to be exactly 100 — Phase 3 never enforced that on the
   * weight rows themselves). A child disabled for this term
   * (ClassSubjectTermStatus, see `disabledChildSubjectIds`) is dropped from
   * that weight sum entirely rather than counted as a 0, so the remaining
   * active children's weights are implicitly renormalized to the group's
   * full 100 for this term instead of the disabled child dragging the
   * average down by its original weight share. Position-in-class (PRD's
   * optional per-subject rank) is assigned in a second pass, once every
   * student's total for a (subjectId, classArmId) pair is known — ranking
   * requires the whole group, not just the one row being written.
   */
  async aggregateForClassCategoryTerm(termId: string, classLevelCategory: ClassLevelCategory): Promise<void> {
    const term = await this.prisma.term.findUniqueOrThrow({ where: { id: termId } });

    const components = await this.prisma.assessmentComponent.findMany({
      where: { termId, classLevelCategory },
      select: { id: true },
    });
    const componentIds = components.map((c) => c.id);
    if (componentIds.length === 0) return;

    const classArms = await this.prisma.classArm.findMany({
      where: { classLevel: { category: classLevelCategory }, academicSessionId: term.academicSessionId },
      select: { id: true },
    });
    const classArmIds = classArms.map((a) => a.id);
    if (classArmIds.length === 0) return;

    const enrollments = await this.prisma.studentSubjectEnrollment.findMany({
      where: { classArmId: { in: classArmIds }, termId, status: EnrollmentStatus.ACTIVE },
      include: { subject: true },
    });

    const scoreEntries = await this.prisma.scoreEntry.findMany({
      where: { assessmentComponentId: { in: componentIds } },
      select: { studentId: true, subjectId: true, score: true },
    });

    const gradeScales = await this.fetchGradeScaleRows();

    const sumScores = (studentId: string, subjectId: string): number =>
      scoreEntries
        .filter((entry) => entry.studentId === studentId && entry.subjectId === subjectId)
        .reduce((sum, entry) => sum + Number(entry.score), 0);

    const written: { id: string; subjectId: string; classArmId: string; totalScore: number }[] = [];
    // One classSubject/status lookup per group (not per student) — every
    // enrollment for a given group subject shares the same disabled-child
    // set for this (classLevelCategory, termId).
    const disabledChildCache = new Map<string, Set<string>>();

    const upsertResult = async (studentId: string, subjectId: string, classArmId: string, totalScore: number) => {
      const { grade, remark } = findGradeScaleMatch(gradeScales, totalScore);
      const row = await this.prisma.subjectTermResult.upsert({
        where: { studentId_subjectId_termId: { studentId, subjectId, termId } },
        create: { studentId, subjectId, classArmId, termId, totalScore, grade, remark },
        update: { totalScore, grade, remark, classArmId },
      });
      written.push({ id: row.id, subjectId, classArmId, totalScore });
    };

    for (const enrollment of enrollments) {
      if (!enrollment.subject.isGroup) {
        const total = sumScores(enrollment.studentId, enrollment.subjectId);
        await upsertResult(enrollment.studentId, enrollment.subjectId, enrollment.classArmId, total);
        continue;
      }

      const weights = await this.prisma.subjectGroupWeight.findMany({
        where: { groupSubjectId: enrollment.subjectId },
      });

      let disabledChildIds = disabledChildCache.get(enrollment.subjectId);
      if (!disabledChildIds) {
        disabledChildIds = await this.disabledChildSubjectIds(enrollment.subjectId, classLevelCategory, termId);
        disabledChildCache.set(enrollment.subjectId, disabledChildIds);
      }

      let weightedSum = 0;
      let weightTotal = 0;
      for (const weight of weights) {
        const childTotal = sumScores(enrollment.studentId, weight.childSubjectId);
        await upsertResult(enrollment.studentId, weight.childSubjectId, enrollment.classArmId, childTotal);
        // A child disabled for this term (ClassSubjectTermStatus) is
        // excluded from the parent's weighted average rather than counted
        // at 0 — its weight share is implicitly redistributed across the
        // remaining active children, since weightTotal ends up being just
        // their own weights' sum instead of the group's full 100.
        if (disabledChildIds.has(weight.childSubjectId)) continue;
        weightedSum += childTotal * Number(weight.weight);
        weightTotal += Number(weight.weight);
      }

      const parentTotal = weightTotal > 0 ? weightedSum / weightTotal : 0;
      await upsertResult(enrollment.studentId, enrollment.subjectId, enrollment.classArmId, parentTotal);
    }

    const groups = new Map<string, typeof written>();
    for (const row of written) {
      const key = `${row.subjectId}:${row.classArmId}`;
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }

    for (const group of groups.values()) {
      const positions = assignPositions(group);
      for (const row of group) {
        await this.prisma.subjectTermResult.update({
          where: { id: row.id },
          data: { position: positions.get(row.id) },
        });
      }
    }
  }

  /**
   * PRD §3.6 (added post-Phase-4): whichever term is chronologically last in
   * its academic session (by Term.startDate, not by name — a school isn't
   * assumed to run exactly 3 terms) grades each subject on the average of
   * that subject's SubjectTermResult.totalScore across every term in the
   * session that has one (a missing term is excluded from the average, not
   * treated as zero) — not that term's own total in isolation. Returns null
   * for any term that isn't the session's last, so the caller knows to keep
   * using the term's own SubjectTermResult data untouched.
   *
   * "Reportable" subjects only (subject.parentSubjectId === null) — a
   * grouped subject's children aren't separately annualized, same
   * "never double-count a group's children alongside its parent" rule as
   * the regular overall-average calc.
   *
   * Position is ranked against classmates in the same ClassArm the student
   * was in for that subject (their most recent — i.e. current-term —
   * ClassArm if available), each ranked by their own annual average, not a
   * single term's total.
   */
  async computeAnnualSummary(studentId: string, termId: string): Promise<AnnualSummary | null> {
    const term = await this.prisma.term.findUniqueOrThrow({ where: { id: termId } });
    const sessionTerms = await this.prisma.term.findMany({
      where: { academicSessionId: term.academicSessionId },
      orderBy: { startDate: "asc" },
    });
    const currentIndex = sessionTerms.findIndex((t) => t.id === termId);
    const isLastTerm = currentIndex === sessionTerms.length - 1;
    if (!isLastTerm) return null;

    const sessionTermIds = sessionTerms.map((t) => t.id);

    const ownResults = await this.prisma.subjectTermResult.findMany({
      where: { studentId, termId: { in: sessionTermIds } },
      include: { subject: true },
    });
    const reportable = ownResults.filter((r) => r.subject.parentSubjectId === null);
    if (reportable.length === 0) return null;

    const gradeScales = await this.fetchGradeScaleRows();

    const bySubject = new Map<string, { classArmId: string; totals: number[] }>();
    for (const result of reportable) {
      const entry = bySubject.get(result.subjectId) ?? { classArmId: result.classArmId, totals: [] };
      entry.totals.push(Number(result.totalScore));
      if (result.termId === termId) entry.classArmId = result.classArmId;
      bySubject.set(result.subjectId, entry);
    }

    const subjects: AnnualSubjectSummary[] = [];
    for (const [subjectId, { classArmId, totals }] of bySubject) {
      const average = totals.reduce((sum, value) => sum + value, 0) / totals.length;

      const classmateResults = await this.prisma.subjectTermResult.findMany({
        where: { subjectId, classArmId, termId: { in: sessionTermIds } },
        select: { studentId: true, totalScore: true },
      });
      const classmateTotals = new Map<string, number[]>();
      for (const classmateResult of classmateResults) {
        const list = classmateTotals.get(classmateResult.studentId) ?? [];
        list.push(Number(classmateResult.totalScore));
        classmateTotals.set(classmateResult.studentId, list);
      }
      const rankable = [...classmateTotals.entries()].map(([id, values]) => ({
        id,
        totalScore: values.reduce((sum, value) => sum + value, 0) / values.length,
      }));
      const positions = assignPositions(rankable);

      const { grade, remark } = findGradeScaleMatch(gradeScales, average);
      subjects.push({ subjectId, average, grade, remark, position: positions.get(studentId) ?? null });
    }

    const overallAverage = subjects.reduce((sum, s) => sum + s.average, 0) / subjects.length;
    const { grade: overallGrade, remark: overallRemark } = findGradeScaleMatch(gradeScales, overallAverage);

    return { subjects, overallAverage, overallGrade, overallRemark };
  }

  /**
   * Child subjects of `groupSubjectId` disabled for this specific
   * (classLevelCategory, termId) via ClassSubjectTermStatus — only the
   * group's own ClassSubject row exists (its children don't get their own,
   * see the ClassSubjectTermStatus model comment in schema.prisma), so the
   * lookup goes: group subject -> its ClassSubject row for this class group
   * -> any ClassSubjectTermStatus rows against it for this term. Public —
   * ReportCardProcessor's per-component weighting (report-card.processor.ts)
   * reuses this rather than duplicating the same lookup.
   */
  async disabledChildSubjectIds(
    groupSubjectId: string,
    classLevelCategory: ClassLevelCategory,
    termId: string,
  ): Promise<Set<string>> {
    const classSubject = await this.prisma.classSubject.findUnique({
      where: { classLevelCategory_subjectId: { classLevelCategory, subjectId: groupSubjectId } },
    });
    if (!classSubject) return new Set();

    const statuses = await this.prisma.classSubjectTermStatus.findMany({
      where: { classSubjectId: classSubject.id, termId, isActive: false },
      select: { subjectId: true },
    });
    return new Set(statuses.map((s) => s.subjectId));
  }

  // Prisma's Decimal type isn't the plain `number` findGradeScaleMatch (in
  // @school/types, framework-free) expects. Public — ReportCardProcessor
  // reuses this rather than duplicating the Decimal-to-number mapping.
  async fetchGradeScaleRows() {
    const scales = await this.prisma.gradeScale.findMany();
    return scales.map((scale) => ({
      minScore: Number(scale.minScore),
      maxScore: Number(scale.maxScore),
      grade: scale.grade,
      remark: scale.remark,
    }));
  }
}
