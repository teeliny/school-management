export interface GradeScaleRow {
  minScore: number;
  maxScore: number;
  grade: string;
  remark: string | null;
}

export interface GradeScaleMatch {
  grade: string | null;
  remark: string | null;
}

/**
 * PRD §3.6: the single place a score gets turned into a grade + remark —
 * used for a subject's own grade, a mid-term subject's normalized-to-
 * percentage grade, and the report-level overall grade, so all three read
 * exactly the same GradeScale configuration the same way.
 */
export function findGradeScaleMatch(scales: GradeScaleRow[], score: number): GradeScaleMatch {
  const match = scales.find((scale) => score >= scale.minScore && score <= scale.maxScore);
  return { grade: match?.grade ?? null, remark: match?.remark ?? null };
}
