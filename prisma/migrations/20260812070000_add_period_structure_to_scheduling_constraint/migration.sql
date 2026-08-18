-- DropIndex
DROP INDEX "scheduling_constraints_scope_key_key";

-- AlterTable
ALTER TABLE "class_subjects" ADD COLUMN     "periodsPerWeek" INTEGER NOT NULL DEFAULT 3;

-- AlterTable
ALTER TABLE "scheduling_constraints" ADD COLUMN     "classLevelCategoryGroup" "ClassLevelCategoryGroup";

-- CreateIndex
CREATE UNIQUE INDEX "scheduling_constraints_scope_classLevelCategoryGroup_key_key" ON "scheduling_constraints"("scope", "classLevelCategoryGroup", "key");

-- CreateIndex (hand-added)
-- Postgres treats NULL <> NULL in a unique index, so the composite index
-- above does not by itself stop two null-classLevelCategoryGroup rows from
-- coexisting for the same (scope, key) — e.g. two CALCULATION_SUBJECTS_MORNING
-- rows for CLASS_TIMETABLE scope. This partial index closes that gap, same
-- precedent as the SUPER_ADMIN/AcademicSession.isCurrent singleton indexes
-- (CLAUDE.md's "Uniqueness enforced at the DB layer" section).
CREATE UNIQUE INDEX "scheduling_constraints_global_scope_key" ON "scheduling_constraints"("scope", "key") WHERE "classLevelCategoryGroup" IS NULL;
