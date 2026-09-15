export interface SubjectPeriodCount {
  subjectId: string;
  name: string;
  code: string;
  periodsPerWeek: number;
}

/**
 * Collapses a set of TimetableSlot rows (one class arm's whole week, or a
 * whole-school listing pre-filtered to one class arm) into one row per
 * distinct subject with its period count — the "how many periods of each
 * subject does this class get" summary the weekly grid itself doesn't
 * surface, since each grid cell only ever shows one period at a time.
 */
export function summarizePeriodsBySubject(
  slots: { subjectId: string; subject: { name: string; code: string } }[],
): SubjectPeriodCount[] {
  const counts = new Map<string, SubjectPeriodCount>();
  for (const slot of slots) {
    const existing = counts.get(slot.subjectId);
    if (existing) {
      existing.periodsPerWeek += 1;
    } else {
      counts.set(slot.subjectId, {
        subjectId: slot.subjectId,
        name: slot.subject.name,
        code: slot.subject.code,
        periodsPerWeek: 1,
      });
    }
  }
  return [...counts.values()].sort((a, b) => b.periodsPerWeek - a.periodsPerWeek || a.name.localeCompare(b.name));
}
