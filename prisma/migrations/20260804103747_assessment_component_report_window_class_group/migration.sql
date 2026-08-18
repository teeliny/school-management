-- AssessmentComponent and ReportWindow move from per-ClassLevel scoping to
-- per-ClassLevelCategory scoping (class group: CRECHE/NURSERY/PRIMARY/JSS/SSS)
-- so e.g. JSS1-3 share one CA/exam structure and one report window per term
-- instead of being configured per concrete class level. Prisma can't express
-- the backfill from the old classLevelId FK into the new enum column, so it's
-- hand-added here (same "hand-edit the generated migration" precedent as the
-- partial unique indexes elsewhere in this repo) before the old column drops.

-- AlterTable: add the new column nullable first so existing rows can be
-- backfilled before it's tightened to NOT NULL.
ALTER TABLE "assessment_components" ADD COLUMN     "classLevelCategory" "ClassLevelCategory";
ALTER TABLE "report_windows" ADD COLUMN     "classLevelCategory" "ClassLevelCategory";

-- Backfill from the class level each row previously pointed at.
UPDATE "assessment_components" ac
SET "classLevelCategory" = cl."category"
FROM "class_levels" cl
WHERE cl."id" = ac."classLevelId";

UPDATE "report_windows" rw
SET "classLevelCategory" = cl."category"
FROM "class_levels" cl
WHERE cl."id" = rw."classLevelId";

ALTER TABLE "assessment_components" ALTER COLUMN "classLevelCategory" SET NOT NULL;
ALTER TABLE "report_windows" ALTER COLUMN "classLevelCategory" SET NOT NULL;

-- DropForeignKey
ALTER TABLE "assessment_components" DROP CONSTRAINT "assessment_components_classLevelId_fkey";

-- DropForeignKey
ALTER TABLE "report_windows" DROP CONSTRAINT "report_windows_classLevelId_fkey";

-- DropIndex
DROP INDEX "assessment_components_termId_classLevelId_type_sequence_key";

-- DropIndex
DROP INDEX "report_windows_termId_classLevelId_key";

-- AlterTable
ALTER TABLE "assessment_components" DROP COLUMN "classLevelId";

-- AlterTable
ALTER TABLE "report_windows" DROP COLUMN "classLevelId";

-- CreateIndex
CREATE UNIQUE INDEX "assessment_components_termId_classLevelCategory_type_sequen_key" ON "assessment_components"("termId", "classLevelCategory", "type", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "report_windows_termId_classLevelCategory_key" ON "report_windows"("termId", "classLevelCategory");
