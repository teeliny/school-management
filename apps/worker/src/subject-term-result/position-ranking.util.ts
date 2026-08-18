export interface RankableResult {
  id: string;
  totalScore: number;
}

/**
 * PRD §3.6: SubjectTermResult's optional "position-in-class" — ranked within
 * a single (subjectId, classArmId) group, standard competition ranking
 * (ties share a rank; the next distinct score skips ahead by the number of
 * students tied ahead of it, e.g. 1, 1, 3 — not 1, 1, 2) since that's the
 * convention Nigerian report cards use ("3rd in class" isn't unique per
 * student when two students tie for 2nd).
 */
export function assignPositions(results: RankableResult[]): Map<string, number> {
  const sorted = [...results].sort((a, b) => b.totalScore - a.totalScore);
  const positions = new Map<string, number>();

  let rank = 0;
  let previousScore: number | null = null;
  let processed = 0;

  for (const result of sorted) {
    processed += 1;
    if (previousScore === null || result.totalScore !== previousScore) {
      rank = processed;
      previousScore = result.totalScore;
    }
    positions.set(result.id, rank);
  }

  return positions;
}
