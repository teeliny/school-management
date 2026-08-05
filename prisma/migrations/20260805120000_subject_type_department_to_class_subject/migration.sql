-- Subject.type/departmentId move to ClassSubject, which is rescoped from
-- per-ClassLevel to per-ClassLevelCategory (class group) — same "hand-edit
-- the generated migration" precedent as
-- 20260804103747_assessment_component_report_window_class_group. A subject's
-- applicability (COMPULSORY/GENERAL/DEPARTMENT) can differ by class group
-- (e.g. CRS: GENERAL for JSS, DEPARTMENT for SSS) — it was previously fixed
-- catalogue-wide on Subject, forcing admins to create duplicate Subject rows
-- (e.g. "CRS" vs "CRST") for the same real subject. Prisma can't express
-- either the classLevelId->classLevelCategory backfill or the
-- Subject->ClassSubject column move, so both are hand-added here before the
-- old columns drop.

-- Verified against the dev DB before writing this: 0 rows collide under
-- (category, subjectId, academicSessionId) once classLevelId collapses to
-- classLevelCategory, so no dedup step is needed ahead of the new unique
-- index.

-- AlterTable: add classLevelCategory nullable first so existing rows can be
-- backfilled before it's tightened to NOT NULL.
ALTER TABLE "class_subjects" ADD COLUMN     "classLevelCategory" "ClassLevelCategory";

UPDATE "class_subjects" cs
SET "classLevelCategory" = cl."category"
FROM "class_levels" cl
WHERE cl."id" = cs."classLevelId";

ALTER TABLE "class_subjects" ALTER COLUMN "classLevelCategory" SET NOT NULL;

-- AlterTable: add type/departmentId nullable first, backfill from the
-- Subject row each ClassSubject points at (that's the current source of
-- truth prior to this migration), then tighten type to NOT NULL.
ALTER TABLE "class_subjects" ADD COLUMN     "type" "SubjectType";
ALTER TABLE "class_subjects" ADD COLUMN     "departmentId" TEXT;

UPDATE "class_subjects" cs
SET "type" = s."type",
    "departmentId" = s."departmentId"
FROM "subjects" s
WHERE s."id" = cs."subjectId";

ALTER TABLE "class_subjects" ALTER COLUMN "type" SET NOT NULL;

-- DropForeignKey
ALTER TABLE "class_subjects" DROP CONSTRAINT "class_subjects_classLevelId_fkey";

-- DropIndex
DROP INDEX "class_subjects_classLevelId_subjectId_academicSessionId_key";

-- AlterTable
ALTER TABLE "class_subjects" DROP COLUMN "classLevelId";
ALTER TABLE "class_subjects" DROP COLUMN "isCompulsoryOverride";

-- CreateIndex
CREATE UNIQUE INDEX "class_subjects_classLevelCategory_subjectId_academicSessi_key" ON "class_subjects"("classLevelCategory", "subjectId", "academicSessionId");

-- AddForeignKey
ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DropForeignKey
ALTER TABLE "subjects" DROP CONSTRAINT "subjects_departmentId_fkey";

-- AlterTable
ALTER TABLE "subjects" DROP COLUMN "type";
ALTER TABLE "subjects" DROP COLUMN "departmentId";
