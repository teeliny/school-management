import type {
  AssessmentProgressClass,
  AssessmentProgressComponent,
  ClassLevelCategory,
  ClassLevelCategoryGroup,
  ProgressCount,
} from "@school/types";

// Pure helpers shared by the assessment-progress organisms — completion
// rules and the by-teacher bucketing. No React, no fetching.

export const UNASSIGNED = "__unassigned__";

export const SECTION_LABEL: Record<ClassLevelCategoryGroup, string> = {
  JSS_SSS: "Secondary (JSS/SSS)",
  CRECHE_NURSERY_PRIMARY: "Primary / Nursery / Reception / Creche",
};
export const CATEGORY_LABEL: Record<ClassLevelCategory, string> = {
  CRECHE: "Creche",
  RECEPTION: "Reception",
  NURSERY: "Nursery",
  PRIMARY: "Primary",
  JSS: "JSS",
  SSS: "SSS",
};

export function isComplete(count: ProgressCount): boolean {
  return count.total > 0 && count.completed >= count.total;
}

export function componentCount(c: AssessmentProgressComponent, total: number): ProgressCount {
  return { completed: c.completed, total };
}

export function subjectComplete(subject: { total: number; components: AssessmentProgressComponent[] }): boolean {
  return subject.components.every((c) => isComplete(componentCount(c, subject.total)));
}

export function classComplete(cls: AssessmentProgressClass): boolean {
  return (
    cls.subjects.every(subjectComplete) &&
    (cls.totalStudents === 0 ||
      (isComplete(cls.classTeacherComments) &&
        isComplete(cls.principalComments) &&
        (cls.skills === null || isComplete(cls.skills))))
  );
}

export function names(staff: { name: string }[], fallback: string): string {
  return staff.length > 0 ? staff.map((s) => s.name).join(", ") : fallback;
}


export interface TeacherBucket<T> {
  key: string;
  name: string;
  items: T[];
}

export function bucketBy<T>(entries: { staff: { staffId: string; name: string }[]; item: T }[], unassignedLabel: string): TeacherBucket<T>[] {
  const map = new Map<string, TeacherBucket<T>>();
  for (const { staff, item } of entries) {
    const owners = staff.length > 0 ? staff : [{ staffId: UNASSIGNED, name: unassignedLabel }];
    for (const owner of owners) {
      const bucket = map.get(owner.staffId) ?? { key: owner.staffId, name: owner.name, items: [] };
      bucket.items.push(item);
      map.set(owner.staffId, bucket);
    }
  }
  // Unassigned last; otherwise alphabetical.
  return [...map.values()].sort((a, b) =>
    a.key === UNASSIGNED ? 1 : b.key === UNASSIGNED ? -1 : a.name.localeCompare(b.name),
  );
}
