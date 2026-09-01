// Shared between create-subject-form.tsx and class-subject-assignment.tsx —
// both let an Admin set a ClassSubject's type/department, either at subject
// creation or when assigning an existing subject to another class group
// (PRD §3.3).
export type SubjectType = "COMPULSORY" | "GENERAL" | "DEPARTMENT";
export type ClassLevelCategory = "CRECHE" | "RECEPTION" | "NURSERY" | "PRIMARY" | "JSS" | "SSS";

export const CLASS_GROUPS: ClassLevelCategory[] = ["CRECHE", "RECEPTION", "NURSERY", "PRIMARY", "JSS", "SSS"];

export const TYPE_LABELS: Record<SubjectType, string> = {
  COMPULSORY: "Compulsory",
  GENERAL: "General (opt-in)",
  DEPARTMENT: "Department-restricted",
};
