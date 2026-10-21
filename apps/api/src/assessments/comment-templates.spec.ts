import {
  BAND_PHRASES,
  PERFORMANCE_BANDS,
  bandsMentioned,
  containsHarshWording,
  forbiddenPronounRegex,
  mentionsOnlyBand,
  performanceBand,
  pronounsFor,
  type PronounSet,
} from "@school/types";
import {
  CLASS_TEACHER_TEMPLATES,
  PRINCIPAL_TEMPLATES,
  classTeacherSuggestions,
  joinNames,
  principalSuggestions,
  type SkillSummary,
} from "./comment-templates";

const PRONOUN_CASES: [string, PronounSet | null][] = [
  ["male", pronounsFor("MALE")],
  ["female", pronounsFor("FEMALE")],
  ["unknown", pronounsFor(null)],
];

describe("performanceBand", () => {
  it.each([
    [100, "EXCELLENT"],
    [80, "EXCELLENT"],
    [79.99, "VERY_GOOD"],
    [70, "VERY_GOOD"],
    [69.99, "GOOD"],
    [60, "GOOD"],
    [59.99, "FAIRLY_GOOD"],
    [50, "FAIRLY_GOOD"],
    [49.99, "FAIR"],
    [45, "FAIR"],
    [44.99, "RELATIVELY_FAIR"],
    [40, "RELATIVELY_FAIR"],
    [39.99, "POOR"],
    [0, "POOR"],
  ])("%s → %s", (avg, band) => {
    expect(performanceBand(avg)).toBe(band);
  });
});

describe("bandsMentioned", () => {
  it("doesn't count a shorter phrase inside a longer one", () => {
    expect(bandsMentioned("A very good result.")).toEqual(["VERY_GOOD"]);
    expect(bandsMentioned("A fairly good result.")).toEqual(["FAIRLY_GOOD"]);
    expect(bandsMentioned("A relatively fair result.")).toEqual(["RELATIVELY_FAIR"]);
    expect(bandsMentioned("A very impressive result.")).toEqual(["VERY_GOOD"]);
    expect(bandsMentioned("A fairly encouraging result.")).toEqual(["RELATIVELY_FAIR"]);
    expect(bandsMentioned("A reasonably good result.")).toEqual(["FAIRLY_GOOD"]);
    expect(bandsMentioned("This result is not yet up to expectation.")).toEqual(["POOR"]);
  });

  it("flags a comment that mixes bands", () => {
    expect(mentionsOnlyBand("An excellent result. Keep up the good work.", "EXCELLENT")).toBe(false);
  });

  it("never treats a band phrase itself as harsh", () => {
    for (const band of PERFORMANCE_BANDS) {
      for (const phrase of BAND_PHRASES[band]) expect({ phrase, harsh: containsHarshWording(phrase) }).toEqual({ phrase, harsh: false });
    }
  });

  it("recognises every phrase as its own band only", () => {
    for (const band of PERFORMANCE_BANDS) {
      for (const phrase of BAND_PHRASES[band]) {
        expect(bandsMentioned(`A ${phrase} result.`)).toEqual([band]);
      }
    }
  });
});

describe("principal templates", () => {
  it("every template, with every synonym, names only its own band", () => {
    for (const band of PERFORMANCE_BANDS) {
      for (const template of PRINCIPAL_TEMPLATES[band]) {
        for (const phrase of BAND_PHRASES[band]) {
          const text = template.text.replace(/\{phrase\}|\{Phrase\}/g, phrase);
          expect({ band, text, ok: mentionsOnlyBand(text, band) }).toEqual({ band, text, ok: true });
        }
      }
    }
  });

  it.each(PRONOUN_CASES)("gives 5 distinct, band-correct, pronoun-correct suggestions (%s)", (_label, pronouns) => {
    for (const band of PERFORMANCE_BANDS) {
      for (let attempt = 0; attempt < 10; attempt++) {
        const out = principalSuggestions(band, { firstName: "Ada", pronouns, seed: `s1:t1:${attempt}` });
        expect(out).toHaveLength(5);
        expect(new Set(out).size).toBe(5);
        for (const comment of out) {
          expect({ comment, ok: mentionsOnlyBand(comment, band) }).toEqual({ comment, ok: true });
          expect(comment).not.toMatch(forbiddenPronounRegex(pronouns));
          expect(comment).not.toMatch(/[{}]/);
          expect(comment).not.toMatch(/\ba [aeiou]/i);
          expect({ comment, harsh: containsHarshWording(comment) }).toEqual({ comment, harsh: false });
        }
      }
    }
  });

  it("varies the synonym across the picks", () => {
    const out = principalSuggestions("EXCELLENT", { firstName: "Ada", pronouns: null, seed: "x" });
    const used = new Set(
      out.flatMap((c) => BAND_PHRASES.EXCELLENT.filter((p) => c.toLowerCase().includes(p))),
    );
    expect(used.size).toBeGreaterThan(1);
  });

  it("is stable for the same seed and changes with the attempt", () => {
    const ctx = { firstName: "Ada", pronouns: pronounsFor("FEMALE"), seed: "s1:t1:0" };
    expect(principalSuggestions("GOOD", ctx)).toEqual(principalSuggestions("GOOD", ctx));
    expect(principalSuggestions("GOOD", ctx)).not.toEqual(principalSuggestions("GOOD", { ...ctx, seed: "s1:t1:1" }));
  });
});

describe("class teacher templates", () => {
  const SKILL_CASES: [string, SkillSummary][] = [
    ["mixed", { strengths: ["Punctuality", "Neatness"], satisfactory: ["Handwriting"], weak: ["Attentiveness"] }],
    ["all strong", { strengths: ["Punctuality", "Neatness", "Politeness"], satisfactory: [], weak: [] }],
    ["all weak", { strengths: [], satisfactory: [], weak: ["Punctuality", "Neatness"] }],
    ["only satisfactory", { strengths: [], satisfactory: ["Punctuality"], weak: [] }],
  ];

  it.each(PRONOUN_CASES)("gives 5 distinct, pronoun-correct suggestions (%s)", (_label, pronouns) => {
    for (const [, skills] of SKILL_CASES) {
      const out = classTeacherSuggestions(skills, { firstName: "Tunde", pronouns, seed: "s:t:0" });
      expect(out).toHaveLength(5);
      expect(new Set(out).size).toBe(5);
      for (const comment of out) {
        expect(comment).not.toMatch(forbiddenPronounRegex(pronouns));
        expect(comment).not.toMatch(/[{}]/);
        expect({ comment, harsh: containsHarshWording(comment) }).toEqual({ comment, harsh: false });
      }
    }
  });

  it("no template contains harsh wording", () => {
    const all = [...CLASS_TEACHER_TEMPLATES, ...PERFORMANCE_BANDS.flatMap((b) => PRINCIPAL_TEMPLATES[b])];
    // Strip tokens first: "{weak}" is a placeholder for skill names, not wording.
    for (const { text } of all) {
      const wording = text.replace(/\{\w+\}/g, "");
      expect({ text, harsh: containsHarshWording(wording) }).toEqual({ text, harsh: false });
    }
  });

  it("uses the student's weak skills only when there are some", () => {
    const out = classTeacherSuggestions(
      { strengths: ["Punctuality"], satisfactory: [], weak: [] },
      { firstName: "Tunde", pronouns: null, seed: "a" },
    );
    expect(out.join(" ")).not.toMatch(/improve(ment)? (on|in) \./);
    expect(CLASS_TEACHER_TEMPLATES.length).toBeGreaterThan(15);
  });

  it("joins names naturally", () => {
    expect(joinNames(["A"])).toBe("a");
    expect(joinNames(["A", "B"])).toBe("a and b");
    expect(joinNames(["A", "B", "C"])).toBe("a, b and c");
  });
});
