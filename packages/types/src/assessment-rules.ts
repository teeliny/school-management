/**
 * PRD §3.6: a term+class-level's AssessmentComponents must sum to 100 before
 * any of them can move to OPEN. Pure and framework-free so both apps/api
 * (the manual force-open check) and apps/worker (the scheduled sweep) apply
 * exactly the same rule rather than two implementations drifting apart.
 */
export function isStructureComplete(maxScores: number[]): boolean {
  const total = maxScores.reduce((sum, value) => sum + value, 0);
  return Math.abs(total - 100) < 0.001;
}

/**
 * Object-storage key for a term report card PDF. The worker writes the file
 * here; the API signs a fresh short-lived URL from it on every read (a
 * signed URL stored at generation time expires and goes stale). Shared so
 * the two apps can't drift on the path.
 */
export function reportCardPdfKey(studentId: string, termId: string, reportType: "MID_TERM" | "FULL_TERM"): string {
  return `report-cards/${studentId}/${termId}/${reportType === "MID_TERM" ? "mid-term" : "full-term"}.pdf`;
}
