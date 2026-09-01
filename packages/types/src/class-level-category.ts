/**
 * Mirrors the Prisma `ClassLevelCategory` enum (prisma/schema.prisma) — the
 * class-group grouping (Creche/Reception/Nursery/Primary/JSS/SSS) that
 * ClassLevel rows belong to, and that AssessmentComponent/ReportWindow are
 * scoped to. Shared so apps/web doesn't redeclare this list locally and drift
 * from the enum.
 */
export type ClassLevelCategory = "CRECHE" | "RECEPTION" | "NURSERY" | "PRIMARY" | "JSS" | "SSS";

export const CLASS_LEVEL_CATEGORIES: ClassLevelCategory[] = ["CRECHE", "RECEPTION", "NURSERY", "PRIMARY", "JSS", "SSS"];
