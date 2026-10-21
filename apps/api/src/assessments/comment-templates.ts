import { BAND_PHRASES, type PerformanceBand, type PronounSet } from "@school/types";

/**
 * Template bank behind CommentSuggestionService. It is the default
 * generator, the fallback when the optional LLM generator fails, and the
 * reference for the PRINCIPAL band phrases.
 *
 * Tokens: {name} (first name), {He}/{he}/{him}/{his}/{His} (pronouns; a
 * template using any of them is skipped when the student's pronouns are
 * unknown), and for CLASS_TEACHER {strengths}/{strength}/{weak}/{fine}
 * (skill names). PRINCIPAL templates use {phrase}/{Phrase} (one of the
 * band's BAND_PHRASES synonyms) with a matching {a}/{A} article.
 *
 * Wording rule for PRINCIPAL: every template contains its own band's phrase
 * and none of the other bands' phrases (no stray "good work" in an
 * EXCELLENT template, no "average" outside FAIR). comment-templates.spec.ts
 * enforces this.
 */

export interface SkillSummary {
  /** EXCELLENT / VERY_GOOD items */
  strengths: string[];
  /** GOOD items */
  satisfactory: string[];
  /** FAIR / POOR items */
  weak: string[];
}

export interface TemplateContext {
  firstName: string;
  pronouns: PronounSet | null;
  /** Seed: stable per student+term, varied per "Regenerate" attempt. */
  seed: string;
}

type Requirement = "strength" | "weak" | "noWeak" | "fine" | "mostlyWeak";
interface Template {
  text: string;
  requires?: Requirement[];
}

export const CLASS_TEACHER_TEMPLATES: Template[] = [
  // Strength-led
  { text: "{name} shows excellent {strengths} and is a delight to have in class.", requires: ["strength"] },
  { text: "{He} has shown commendable {strengths} this term. Well done!", requires: ["strength"] },
  { text: "{name} is particularly strong in {strengths}. Keep it up.", requires: ["strength"] },
  { text: "A well-behaved pupil who stands out in {strengths}.", requires: ["strength"] },
  { text: "{His} {strength} is worthy of emulation. Keep it up!", requires: ["strength"] },
  // Balanced
  {
    text: "{name} displays good {strengths}, but needs to work more on {weak}.",
    requires: ["strength", "weak"],
  },
  {
    text: "{He} is doing well in {strengths}; however, {he} should pay more attention to {weak}.",
    requires: ["strength", "weak"],
  },
  {
    text: "Strong in {strengths}, but there is room for improvement in {weak}.",
    requires: ["strength", "weak"],
  },
  // All strong / no weaknesses
  { text: "{name} is a well-mannered, dependable pupil. A pleasure to teach.", requires: ["noWeak"] },
  { text: "{He} has been a good example to {his} classmates this term.", requires: ["noWeak"] },
  { text: "An exemplary pupil in conduct and character. Keep it up!", requires: ["noWeak", "strength"] },
  { text: "{name} has conducted {him}self admirably all term.", requires: ["noWeak"] },
  // Satisfactory
  { text: "{name} is doing well in {fine} and can do even better with more effort.", requires: ["fine"] },
  { text: "{His} {fine} is coming along nicely; {he} can aim even higher next term.", requires: ["fine"] },
  // Weak-led
  { text: "{name} is encouraged to keep working on {weak}. With guidance, {he} will do better.", requires: ["weak"] },
  { text: "A little more effort in {weak} will help. {name} can do it!", requires: ["weak"] },
  { text: "With a little more effort in {weak}, {he} will do even better.", requires: ["weak"] },
  {
    text: "{name} will benefit from extra encouragement, especially in {weak}.",
    requires: ["weak", "mostlyWeak"],
  },
  { text: "Support at home with {weak} will help a great deal.", requires: ["weak"] },
  // General — always applicable
  { text: "{name} is a pleasant pupil. Keep working hard." },
  { text: "{name} has made steady progress this term." },
  { text: "A cooperative pupil. Keep striving for excellence." },
  { text: "{He} relates well with classmates and teachers alike." },
  { text: "{name} should keep putting in effort next term." },
];

// {phrase} is one of the band's BAND_PHRASES (rotated across the picks so
// the five suggestions don't all say the same word); {a}/{A} is the
// matching article and {Phrase} the capitalised form.
export const PRINCIPAL_TEMPLATES: Record<PerformanceBand, Template[]> = {
  EXCELLENT: [
    { text: "{A} {phrase} result. Keep it up, {name}!" },
    { text: "{A} {phrase} performance this term. We are very proud of this achievement." },
    { text: "{name} has put up {a} {phrase} performance. Well done!" },
    { text: "{Phrase} result! {He} should keep up this wonderful standard." },
    { text: "What {a} {phrase} result, {name}. Keep soaring higher." },
    { text: "This is {a} {phrase} performance. We are proud of {him}." },
    { text: "{name}'s result is {phrase}. Congratulations, and keep shining!" },
    { text: "{A} {phrase} performance. Congratulations and keep it up!" },
  ],
  VERY_GOOD: [
    { text: "{A} {phrase} result. Keep it up, {name}." },
    { text: "{name} has put up {a} {phrase} performance this term. Well done!" },
    { text: "{Phrase} performance. {He} is well on the way to the top." },
    { text: "{A} {phrase} result. {name} can reach even greater heights." },
    { text: "This is {a} {phrase} performance. Well done!" },
    { text: "{Phrase} result. We are proud of {him}; keep it up." },
    { text: "{Phrase} result, {name}. The sky is the limit!" },
    { text: "{A} {phrase} performance. Keep up the hard work." },
  ],
  GOOD: [
    { text: "{A} {phrase} result. Well done, {name}; even better things lie ahead." },
    { text: "{Phrase} performance. Keep it up, {name}." },
    { text: "{name} has put up {a} {phrase} performance this term. Well done!" },
    { text: "{A} {phrase} result. {He} is capable of even more, so keep going." },
    { text: "This is {a} {phrase} performance. Keep aiming higher." },
    { text: "{Phrase} result. We believe {he} can climb even higher next term." },
    { text: "{Phrase} result, {name}. Keep up the effort." },
    { text: "{A} {phrase} performance. Well done, and keep pushing forward." },
  ],
  FAIRLY_GOOD: [
    { text: "{A} {phrase} result. With a little more effort, {name} will go far." },
    { text: "{Phrase} performance. {He} has what it takes to do even better." },
    { text: "{name} has put up {a} {phrase} performance this term. Keep going!" },
    { text: "{A} {phrase} result. A bit more focus will bring great results next term." },
    { text: "This is {a} {phrase} performance. Keep working at it; better days are ahead." },
    { text: "{Phrase} result. We are confident {he} will improve further." },
    { text: "{Phrase} result, {name}. Keep it up and aim higher." },
    { text: "{A} {phrase} performance. There is lots of room to grow, so keep at it." },
  ],
  FAIR: [
    { text: "{A} {phrase} result. {name} can do even better with a little more effort." },
    { text: "{Phrase} performance. {He} has the ability to improve, so keep trying." },
    { text: "{name} has put up {a} {phrase} performance this term. Keep pressing on!" },
    { text: "{A} {phrase} result. More practice will make a big difference next term." },
    { text: "This is {a} {phrase} performance. We believe in {him}; keep working hard." },
    { text: "{Phrase} result. {He} is capable of much more." },
    { text: "{Phrase} result, {name}. Keep trying; you can do it." },
    { text: "{A} {phrase} performance. With consistent effort, the next result will be better." },
  ],
  RELATIVELY_FAIR: [
    { text: "{A} {phrase} result. With extra effort, {name} can do much better." },
    { text: "{Phrase} performance. {He} can improve with regular practice and support." },
    { text: "{name} has put up {a} {phrase} performance this term. Keep trying!" },
    { text: "{A} {phrase} result. Extra practice at home will help a great deal." },
    { text: "This is {a} {phrase} performance. We are confident of improvement next term." },
    { text: "{Phrase} result. {He} has the potential to do much better; keep going." },
    { text: "{Phrase} result, {name}. Don't give up; better results are coming." },
    { text: "{A} {phrase} performance. Consistent effort will bring improvement." },
  ],
  POOR: [
    { text: "This term's result is {phrase}, but {name} can do much better with more effort. We believe in you!" },
    { text: "The result is {phrase} this term. With support at home and school, {he} will improve." },
    { text: "{name}'s result is {phrase} this term, but there is plenty of time to turn things around." },
    { text: "This result is {phrase}. Extra lessons and encouragement at home will help a great deal." },
    { text: "The result this term is {phrase}. {He} has the ability to improve; we are here to help." },
    { text: "This result is {phrase}, but with hard work and encouragement, {name} will improve." },
    { text: "{name}'s result is {phrase}. Don't give up; next term can be much better." },
    { text: "This term's performance is {phrase}. With focus and support, better days are ahead." },
  ],
};

const PRONOUN_TOKEN = /\{(He|he|him|his|His)\}/;

/** Joins skill names naturally: "a", "a and b", "a, b and c". */
export function joinNames(names: string[]): string {
  const lower = names.map((n) => n.trim().toLowerCase()).filter(Boolean);
  if (lower.length <= 1) return lower[0] ?? "";
  return `${lower.slice(0, -1).join(", ")} and ${lower[lower.length - 1]}`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Deterministic PRNG so the same student+term+attempt gives the same picks.
function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function fill(text: string, ctx: TemplateContext, extra: Record<string, string>): string {
  const p = ctx.pronouns;
  const values: Record<string, string> = {
    name: ctx.firstName,
    He: p ? capitalise(p.subj) : "",
    he: p?.subj ?? "",
    him: p?.obj ?? "",
    his: p?.poss ?? "",
    His: p ? capitalise(p.poss) : "",
    ...extra,
  };
  const filled = text.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
  return capitalise(filled.replace(/\s+/g, " ").trim());
}

/**
 * Takes up to `count` distinct filled templates, alternating between ones
 * that use the first name and ones that don't, so roughly half the picks
 * name the student.
 */
function pick(templates: Template[], ctx: TemplateContext, extra: Record<string, string>, count: number): string[] {
  const usable = templates.filter((t) => ctx.pronouns || !PRONOUN_TOKEN.test(t.text));
  const random = seededRandom(ctx.seed);
  const withName = shuffle(
    usable.filter((t) => t.text.includes("{name}")),
    random,
  );
  const withoutName = shuffle(
    usable.filter((t) => !t.text.includes("{name}")),
    random,
  );
  const ordered: Template[] = [];
  const startWithName = random() < 0.5;
  while (withName.length || withoutName.length) {
    const [first, second] = startWithName ? [withName, withoutName] : [withoutName, withName];
    if (first.length) ordered.push(first.shift()!);
    if (second.length) ordered.push(second.shift()!);
  }

  const out: string[] = [];
  for (const template of ordered) {
    const text = fill(template.text, ctx, extra);
    if (!out.includes(text)) out.push(text);
    if (out.length === count) break;
  }
  return out;
}

export function classTeacherSuggestions(skills: SkillSummary, ctx: TemplateContext, count = 5): string[] {
  const strengths = skills.strengths.slice(0, 3);
  const weak = skills.weak.slice(0, 2);
  const fine = skills.satisfactory.slice(0, 2);
  const totalRated = skills.strengths.length + skills.satisfactory.length + skills.weak.length;
  const has: Record<Requirement, boolean> = {
    strength: strengths.length > 0,
    weak: weak.length > 0,
    noWeak: skills.weak.length === 0,
    fine: fine.length > 0,
    mostlyWeak: totalRated > 0 && skills.weak.length * 2 > totalRated,
  };
  const applicable = CLASS_TEACHER_TEMPLATES.filter((t) => (t.requires ?? []).every((r) => has[r]));
  const extra = {
    strengths: joinNames(strengths),
    strength: joinNames(strengths.slice(0, 1)),
    weak: joinNames(weak),
    fine: joinNames(fine),
  };
  // Templates that speak to this student's actual ratings come first; the
  // general ones only top the list up to `count`.
  const specific = pick(
    applicable.filter((t) => t.requires?.length),
    ctx,
    extra,
    count,
  );
  const general = pick(
    applicable.filter((t) => !t.requires?.length),
    { ...ctx, seed: `${ctx.seed}:general` },
    extra,
    count,
  );
  return [...specific, ...general.filter((g) => !specific.includes(g))].slice(0, count);
}

export function principalSuggestions(band: PerformanceBand, ctx: TemplateContext, count = 5): string[] {
  const phrases = BAND_PHRASES[band];
  const offset = Math.floor(seededRandom(`${ctx.seed}:phrase`)() * phrases.length);
  // Bake a phrase into each template up front, rotating through the band's
  // synonyms, so whichever five get picked use a mix of wordings.
  const templates = PRINCIPAL_TEMPLATES[band].map((t, i) => {
    const phrase = phrases[(offset + i) % phrases.length]!;
    const a = /^[aeiou]/i.test(phrase) ? "an" : "a";
    const text = t.text
      .replace(/\{phrase\}/g, phrase)
      .replace(/\{Phrase\}/g, capitalise(phrase))
      .replace(/\{a\}/g, a)
      .replace(/\{A\}/g, capitalise(a));
    return { ...t, text };
  });
  return pick(templates, ctx, {}, count);
}
