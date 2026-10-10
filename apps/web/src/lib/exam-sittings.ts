import { examArrangementFor, type ClassLevelCategory } from "@school/types";

export interface SittingComponentInput {
  id: string;
  name: string;
  type: "CA" | "MID_TERM" | "EXAM";
  termId: string;
  classLevelCategory: ClassLevelCategory | string;
  sequence: number;
}

export interface SittingOption {
  // The sitting's representative component — any component of a sitting
  // resolves to the whole displayed sitting server-side (apps/api
  // exam-sitting.ts), so this one id stands for all of them.
  id: string;
  label: string;
  type: "MID_TERM" | "EXAM";
  // The sitting's categories that actually have a component this term.
  categories: ClassLevelCategory[];
  componentIds: string[];
  // One component per GENERATION sitting within this displayed one — usually
  // just `id`, but Nursery + Primary's exam is generated as two runs (Basic's
  // mixed hall, Reception/Nursery per arm), so generating it posts one
  // request per entry.
  generationIds: string[];
}

const CATEGORY_ORDER: ClassLevelCategory[] = ["RECEPTION", "NURSERY", "PRIMARY", "JSS", "SSS"];

/**
 * MID_TERM/EXAM components collapsed into one option per displayed exam
 * sitting (examArrangementFor's displayCategories — JSS + SSS, and Reception
 * + Nursery + Primary), since picking any component of it shows the same
 * combined timetable and generates every sitting inside it. Creche
 * (never a generation target) and CA components are dropped. Ordered mid-term
 * first, then by section.
 */
export function groupComponentsBySitting(components: SittingComponentInput[]): SittingOption[] {
  const exams = components.filter(
    (c): c is SittingComponentInput & { type: "MID_TERM" | "EXAM" } =>
      (c.type === "MID_TERM" || c.type === "EXAM") && c.classLevelCategory !== "CRECHE",
  );
  const bySitting = new Map<string, SittingOption>();
  for (const c of exams) {
    const sitting = examArrangementFor(c.classLevelCategory as ClassLevelCategory, c.type).displayCategories;
    const key = `${c.termId}|${c.type}|${c.sequence}|${sitting.join(",")}`;
    if (bySitting.has(key)) continue;
    const members = exams.filter(
      (o) =>
        o.termId === c.termId &&
        o.type === c.type &&
        o.sequence === c.sequence &&
        sitting.includes(o.classLevelCategory as ClassLevelCategory),
    );
    const categories = sitting.filter((cat) => members.some((m) => m.classLevelCategory === cat));
    const generationIds = new Map<string, string>();
    for (const m of members) {
      const generationKey = examArrangementFor(m.classLevelCategory as ClassLevelCategory, c.type).sittingCategories.join(",");
      if (!generationIds.has(generationKey)) generationIds.set(generationKey, m.id);
    }
    bySitting.set(key, {
      id: c.id,
      label: `${categories.join(" + ")} · ${c.name}`,
      type: c.type,
      categories,
      componentIds: members.map((m) => m.id),
      generationIds: [...generationIds.values()],
    });
  }
  const firstCategory = (o: SittingOption) => CATEGORY_ORDER.indexOf(o.categories[0]!);
  return [...bySitting.values()].sort(
    (a, b) => (a.type === b.type ? 0 : a.type === "MID_TERM" ? -1 : 1) || firstCategory(a) - firstCategory(b),
  );
}

/** The sitting option a component belongs to (e.g. a deep-linked SSS component → the JSS + SSS option). */
export function sittingOptionFor(options: SittingOption[], componentId: string): SittingOption | undefined {
  return options.find((o) => o.componentIds.includes(componentId));
}
