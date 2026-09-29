/**
 * Mirrors the Prisma `ClassLevelCategory` enum (prisma/schema.prisma) — the
 * class-group grouping (Creche/Reception/Nursery/Primary/JSS/SSS) that
 * ClassLevel rows belong to, and that AssessmentComponent/ReportWindow are
 * scoped to. Shared so apps/web doesn't redeclare this list locally and drift
 * from the enum.
 */
export type ClassLevelCategory = "CRECHE" | "RECEPTION" | "NURSERY" | "PRIMARY" | "JSS" | "SSS";

export const CLASS_LEVEL_CATEGORIES: ClassLevelCategory[] = ["CRECHE", "RECEPTION", "NURSERY", "PRIMARY", "JSS", "SSS"];

/**
 * Client-side mirror of apps/api's resolvePrincipalHeadteacherCategories
 * (src/common/class-level-category-scope.ts) — the section a Principal/Vice
 * Principal (JSS/SSS) or Headteacher (Creche–Primary) is scoped to, or null
 * when none of those titles is held. Takes only assignment types; callers
 * treat Super-Admin/Admin as unscoped before calling this, same as the API.
 */
export function sectionLeadCategories(assignmentTypes: string[]): ClassLevelCategory[] | null {
  const secondary = assignmentTypes.includes("PRINCIPAL") || assignmentTypes.includes("VICE_PRINCIPAL");
  const primary = assignmentTypes.includes("HEADTEACHER");
  if (!secondary && !primary) return null;
  return [
    ...(primary ? (["CRECHE", "RECEPTION", "NURSERY", "PRIMARY"] as const) : []),
    ...(secondary ? (["JSS", "SSS"] as const) : []),
  ];
}
