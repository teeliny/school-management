/**
 * Auto-generated CLASS_TEACHER / PRINCIPAL report-comment suggestions.
 * Suggestions are advisory only — nothing here is ever saved without the
 * user picking/editing one and pressing Save through the normal
 * POST /report-comments flow.
 */

export type PerformanceBand =
  | "EXCELLENT"
  | "VERY_GOOD"
  | "GOOD"
  | "FAIRLY_GOOD"
  | "FAIR"
  | "RELATIVELY_FAIR"
  | "POOR";

export const PERFORMANCE_BANDS: PerformanceBand[] = [
  "EXCELLENT",
  "VERY_GOOD",
  "GOOD",
  "FAIRLY_GOOD",
  "FAIR",
  "RELATIVELY_FAIR",
  "POOR",
];

/** ≥80 excellent, ≥70 very good, ≥60 good, ≥50 fairly good, ≥45 fair, ≥40 relatively fair, else poor. */
export function performanceBand(average: number): PerformanceBand {
  if (average >= 80) return "EXCELLENT";
  if (average >= 70) return "VERY_GOOD";
  if (average >= 60) return "GOOD";
  if (average >= 50) return "FAIRLY_GOOD";
  if (average >= 45) return "FAIR";
  if (average >= 40) return "RELATIVELY_FAIR";
  return "POOR";
}

/**
 * Acceptable phrases for each band: the canonical phrase first, then its
 * synonyms. Every phrase reads as an adjective before "result"/"performance"
 * ("a highly commendable result"), except POOR's, which read after "is"
 * ("this result is below expectation"). All of them are deliberately
 * gentle, since these comments go home to parents and children, and the
 * lower bands describe the result, never the child. The sets must not
 * overlap across bands, apart from a shorter phrase sitting inside a longer
 * one ("good" in "very good"), which bandsMentioned() resolves by matching
 * the longest phrase first.
 */
export const BAND_PHRASES: Record<PerformanceBand, string[]> = {
  EXCELLENT: ["excellent", "outstanding", "exceptional", "superb", "brilliant"],
  VERY_GOOD: ["very good", "very impressive", "highly commendable", "very commendable"],
  GOOD: ["good", "commendable", "impressive", "pleasing"],
  FAIRLY_GOOD: ["fairly good", "reasonably good", "satisfactory", "decent"],
  FAIR: ["fair", "steady", "reasonable"],
  RELATIVELY_FAIR: ["relatively fair", "fairly encouraging", "modest"],
  POOR: ["below expectation", "not yet up to expectation", "below the expected standard"],
};

/**
 * Words that must never appear in a generated comment, whatever the band,
 * because they label the child rather than encourage them. Checked against
 * both template and LLM output.
 */
export const HARSH_WORDS = [
  "poor",
  "poorly",
  "weak",
  "lazy",
  "dull",
  "bad",
  "terrible",
  "disappointing",
  "disappointed",
  "unsatisfactory",
  "failure",
  "failed",
  "failing",
  "careless",
  "unserious",
  "sit up",
  "below-average",
  "below average",
  "worst",
  "struggling",
];
const HARSH_PATTERN = new RegExp(`\\b(${HARSH_WORDS.map((w) => w.replace(/[- ]/g, "[- ]")).join("|")})\\b`, "i");

export function containsHarshWording(comment: string): boolean {
  return HARSH_PATTERN.test(comment);
}

export const BAND_LABELS: Record<PerformanceBand, string> = {
  EXCELLENT: "Excellent",
  VERY_GOOD: "Very good",
  GOOD: "Good",
  FAIRLY_GOOD: "Fairly good",
  FAIR: "Fair",
  RELATIVELY_FAIR: "Relatively fair",
  POOR: "Poor",
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Every phrase of every band, longest first, so "very good" is matched (and
// blanked out) before "good" can match inside it.
const PHRASES_LONGEST_FIRST: { band: PerformanceBand; pattern: RegExp }[] = PERFORMANCE_BANDS.flatMap((band) =>
  BAND_PHRASES[band].map((phrase) => ({ band, phrase })),
)
  .sort((a, b) => b.phrase.length - a.phrase.length)
  .map(({ band, phrase }) => ({
    band,
    // "-" and spaces in a phrase also match the other ("below average").
    pattern: new RegExp(`\\b${escapeRegExp(phrase).replace(/[- ]/g, "[- ]")}\\b`, "gi"),
  }));

/**
 * Which bands a comment's wording matches. A principal comment should match
 * exactly its own band, since a "good" comment that also says "excellent"
 * would mislead. Longer phrases are matched and blanked out first, so "very
 * good" doesn't also count as "good" and "relatively fair" doesn't also
 * count as "fair". This deliberately avoids regex lookbehind, which old
 * Safari can't parse, and this file ships in the web bundle.
 */
export function bandsMentioned(comment: string): PerformanceBand[] {
  let rest = comment;
  const found = new Set<PerformanceBand>();
  for (const { band, pattern } of PHRASES_LONGEST_FIRST) {
    pattern.lastIndex = 0;
    if (pattern.test(rest)) {
      found.add(band);
      pattern.lastIndex = 0;
      rest = rest.replace(pattern, " ");
    }
  }
  return PERFORMANCE_BANDS.filter((band) => found.has(band));
}

/** True when the comment names exactly `band` and no other band. */
export function mentionsOnlyBand(comment: string, band: PerformanceBand): boolean {
  const mentioned = bandsMentioned(comment);
  return mentioned.length === 1 && mentioned[0] === band;
}

export type StudentGender = "MALE" | "FEMALE" | "OTHER";

export interface PronounSet {
  /** he / she */
  subj: string;
  /** him / her */
  obj: string;
  /** his / her */
  poss: string;
}

/** `null` means "avoid pronouns entirely" (gender OTHER or not recorded). */
export function pronounsFor(gender: StudentGender | null | undefined): PronounSet | null {
  if (gender === "MALE") return { subj: "he", obj: "him", poss: "his" };
  if (gender === "FEMALE") return { subj: "she", obj: "her", poss: "her" };
  return null;
}

/** Pronouns a comment must NOT contain, given the student's pronoun set. */
export function forbiddenPronounRegex(pronouns: PronounSet | null): RegExp {
  if (!pronouns) return /\b(he|she|him|her|his|hers|himself|herself)\b/i;
  if (pronouns.subj === "he") return /\b(she|her|hers|herself)\b/i;
  return /\b(he|him|his|himself)\b/i;
}

export type SuggestibleCommentType = "CLASS_TEACHER" | "PRINCIPAL";

export interface CommentSuggestionResponse {
  suggestions: string[];
  source: "template" | "llm";
  band?: PerformanceBand;
  average?: number;
}
