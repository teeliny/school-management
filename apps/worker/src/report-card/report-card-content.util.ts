import { computeAttendancePercentage, findGradeScaleMatch, type GradeScaleRow } from "@school/types";

export interface MidTermSubjectScoreInput {
  subjectId: string;
  subjectName: string;
  // Raw score on the term's single MID_TERM-type component — null if the
  // student hasn't been scored on it yet.
  score: number | null;
  maxScore: number;
}

export interface MidTermSnapshotSubject {
  subjectId: string;
  subjectName: string;
  score: number | null;
  maxScore: number;
  // score normalized to a percentage of maxScore — null when score is null.
  percentage: number | null;
  grade: string | null;
  remark: string | null;
}

export interface MidTermSnapshot {
  subjects: MidTermSnapshotSubject[];
  overallPercentage: number | null;
  overallGrade: string | null;
  // No overallRemark by design — see PRD §3.6: MID_TERM's overall line is
  // percentage + grade only, unlike FULL_TERM's average/grade/remark.
}

/**
 * Design revised post-Phase-4 (PRD §3.6): the mid-term report shows only the
 * term's single MID_TERM-type component's score per subject — not a
 * cumulative CA+Mid-Term subtotal, since CA scores are typically still
 * `OPEN`/entering at this point in the term. Each subject's score is
 * normalized to a percentage of that component's maxScore (components
 * aren't always out of 100) and matched against GradeScale the same way a
 * SubjectTermResult is, so each subject — and the report overall — gets a
 * grade too now. Pure data assembly, separate from PDF rendering.
 */
export function buildMidTermSnapshot(subjects: MidTermSubjectScoreInput[], gradeScales: GradeScaleRow[]): MidTermSnapshot {
  const subjectRows: MidTermSnapshotSubject[] = subjects.map((subject) => {
    const percentage = subject.score === null ? null : (subject.score / subject.maxScore) * 100;
    const { grade, remark } = percentage === null ? { grade: null, remark: null } : findGradeScaleMatch(gradeScales, percentage);
    return {
      subjectId: subject.subjectId,
      subjectName: subject.subjectName,
      score: subject.score,
      maxScore: subject.maxScore,
      percentage,
      grade,
      remark,
    };
  });

  const percentages = subjectRows.map((s) => s.percentage).filter((p): p is number => p !== null);
  const overallPercentage = percentages.length > 0 ? percentages.reduce((sum, p) => sum + p, 0) / percentages.length : null;
  const overallGrade = overallPercentage === null ? null : findGradeScaleMatch(gradeScales, overallPercentage).grade;

  return { subjects: subjectRows, overallPercentage, overallGrade };
}

export interface FullTermComponentScoreInput {
  name: string;
  score: number | null;
  maxScore: number;
}

export interface FullTermPriorTermTotalInput {
  termName: string;
  // null when the student has no SubjectTermResult for that subject in that
  // prior term (e.g. they weren't enrolled in it yet), not a blank zero.
  total: number | null;
}

export interface FullTermSubjectResultInput {
  subjectName: string;
  // This term's per-component breakdown (e.g. "1st CA", "2nd CA", "Exam"),
  // read from ScoreEntry — not just the SubjectTermResult total.
  components: FullTermComponentScoreInput[];
  totalScore: number;
  // Lowest/highest totalScore among every student taking this subject in the
  // student's own class arm this term (same population SubjectTermResult's
  // own position ranking is computed against) — null when there's only this
  // one student's result to compare against, or the class hasn't been
  // aggregated yet. Class-wide context, not this student's own min/max.
  classLowScore: number | null;
  classHighScore: number | null;
  // Additive across the session: empty for the session's first term, one
  // entry for the second, two for the third, etc.
  priorTerms: FullTermPriorTermTotalInput[];
  // The *effective* grade/remark/position to display — already resolved by
  // the caller (report-card.processor.ts) to either this term's own
  // SubjectTermResult values or, on the session's last term, the annual
  // (cross-term average) values from SubjectTermResultService.
  // computeAnnualSummary. This function has no opinion on which applies.
  grade: string | null;
  remark: string | null;
  position: number | null;
  // This subject's totalScore averaged across every term in the session the
  // student actually has a SubjectTermResult for (SubjectTermResultService.
  // computeAnnualSummary — join-late aware: a term the student wasn't
  // enrolled for yet is excluded from the average, not treated as a zero).
  // Only set on the session's last term (mirrors `grade`/`remark`/`position`
  // switching to the annual values there); null on every earlier term.
  annualAverage: number | null;
}

export interface FullTermOverallInput {
  // Whether grade/remark/position above (and average/grade/remark here)
  // reflect the session's annual average rather than just this term.
  isAnnual: boolean;
  average: number | null;
  grade: string | null;
  remark: string | null;
}

export interface FullTermSkillRatingInput {
  groupName: string;
  // Display order — the group's own order field, then this rating's item's
  // order within it. Sorted on here rather than trusted from query order,
  // since a plain SkillRating.findMany has no natural ordering of its own.
  groupOrder: number;
  itemOrder: number;
  name: string;
  rating: string;
}

export interface FullTermSkillGroupContent {
  name: string;
  items: { name: string; rating: string }[];
}

export interface FullTermCommentsInput {
  classTeacherComment: string | null;
  principalComment: string | null;
}

export interface FullTermComponentHeader {
  name: string;
  maxScore: number;
}

export interface FullTermAttendanceInput {
  schoolDaysOpened: number;
  daysPresent: number;
}

export interface FullTermAttendanceSummary {
  schoolDaysOpened: number;
  daysPresent: number;
  percentage: number | null;
}

export interface FullTermContent {
  subjects: FullTermSubjectResultInput[];
  // The term's assessment components (name + obtainable score) in display
  // order — every subject's `components` array lines up against this same
  // list, so the PDF renders one column per component (labeled e.g. "1ST
  // TEST / 10") instead of cramming them into a single text cell.
  components: FullTermComponentHeader[];
  // Sum of every component's maxScore — the obtainable score shown next to
  // "TOTAL" in the header (e.g. "TOTAL / 100").
  totalObtainable: number;
  isAnnual: boolean;
  overallAverage: number | null;
  overallGrade: string | null;
  overallRemark: string | null;
  // In display order — group by group (each group's own `order`), then
  // item by item within a group (each item's own `order`). Only groups
  // this student has at least one rating in are ever present (see
  // buildFullTermContent) — a group the student's class level doesn't use
  // is simply absent, not an empty section.
  skillGroups: FullTermSkillGroupContent[];
  classTeacherComment: string | null;
  principalComment: string | null;
  // PRD §3.6/§3.7: "days present / school-days-opened this term" — null when
  // the caller has no attendance data to offer (kept optional at the call
  // site so every existing 5-arg buildFullTermContent call keeps compiling).
  attendance: FullTermAttendanceSummary | null;
}

/**
 * The full-term report's content — per-subject breakdown/totals/prior-term
 * columns/grade+remark+position (already resolved by the caller, see
 * FullTermSubjectResultInput's own doc comment) plus skill ratings grouped
 * by SkillGroup and the two required comments. Publish-gate completeness itself
 * is checked in TermReportCardService (api), not here — generation always
 * renders whatever exists, per the PRD FR4.7 design (Admin can preview an
 * incomplete card before every piece is in).
 */
export function buildFullTermContent(
  subjectResults: FullTermSubjectResultInput[],
  components: FullTermComponentHeader[],
  overall: FullTermOverallInput,
  skillRatings: FullTermSkillRatingInput[],
  comments: FullTermCommentsInput,
  attendance: FullTermAttendanceInput | null = null,
): FullTermContent {
  return {
    subjects: [...subjectResults].sort((a, b) => a.subjectName.localeCompare(b.subjectName)),
    components,
    totalObtainable: components.reduce((sum, c) => sum + c.maxScore, 0),
    isAnnual: overall.isAnnual,
    overallAverage: overall.average,
    overallGrade: overall.grade,
    overallRemark: overall.remark,
    skillGroups: groupSkillRatings(skillRatings),
    classTeacherComment: comments.classTeacherComment,
    principalComment: comments.principalComment,
    attendance: attendance && {
      schoolDaysOpened: attendance.schoolDaysOpened,
      daysPresent: attendance.daysPresent,
      percentage: computeAttendancePercentage(attendance.daysPresent, attendance.schoolDaysOpened),
    },
  };
}

/**
 * Buckets flat skill ratings by their group name, sorted groups-first by
 * groupOrder then items-within-a-group by itemOrder — a plain
 * SkillRating.findMany has no natural ordering, so without this the PDF
 * previously rendered items in whatever order Postgres happened to return
 * them (a real bug: "Numbers"/"Letters" items interleaved with unrelated
 * ones instead of sitting together).
 */
function groupSkillRatings(skillRatings: FullTermSkillRatingInput[]): FullTermSkillGroupContent[] {
  const byGroup = new Map<string, { order: number; items: FullTermSkillRatingInput[] }>();
  for (const rating of skillRatings) {
    const entry = byGroup.get(rating.groupName) ?? { order: rating.groupOrder, items: [] };
    entry.items.push(rating);
    byGroup.set(rating.groupName, entry);
  }

  return [...byGroup.entries()]
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([name, { items }]) => ({
      name,
      items: [...items].sort((a, b) => a.itemOrder - b.itemOrder).map((item) => ({ name: item.name, rating: item.rating })),
    }));
}
