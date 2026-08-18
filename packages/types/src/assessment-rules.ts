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
