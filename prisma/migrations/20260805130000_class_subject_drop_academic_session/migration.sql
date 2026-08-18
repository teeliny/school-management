-- ClassSubject drops its AcademicSession scoping entirely — a subject's
-- class-group assignment (which class groups it belongs to, and how) is
-- curriculum structure, not something that resets every session the way
-- AssessmentComponent's CA/exam structure does. It now persists until an
-- Admin explicitly changes it, with no per-session duplication and no
-- carry-forward step needed on new-session creation.

-- Dedup first: the prior session-rollover behavior (AcademicSessionService
-- .create) could produce more than one row per (classLevelCategory,
-- subjectId) across different sessions — collapsing to a single row per
-- (classLevelCategory, subjectId) would violate the new unique index
-- otherwise. Keep the most recently created row per pair, drop the rest
-- (verified against the dev DB first: exactly one such duplicate pair
-- existed, both rows identical on type/departmentId, no
-- ClassSubjectTermStatus rows attached to either side).
DELETE FROM "class_subjects" cs
WHERE cs.id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY "classLevelCategory", "subjectId" ORDER BY "createdAt" DESC
    ) AS rn
    FROM "class_subjects"
  ) ranked
  WHERE ranked.rn > 1
);

-- DropForeignKey
ALTER TABLE "class_subjects" DROP CONSTRAINT "class_subjects_academicSessionId_fkey";

-- DropIndex
DROP INDEX "class_subjects_classLevelCategory_subjectId_academicSessi_key";

-- AlterTable
ALTER TABLE "class_subjects" DROP COLUMN "academicSessionId";

-- CreateIndex
CREATE UNIQUE INDEX "class_subjects_classLevelCategory_subjectId_key" ON "class_subjects"("classLevelCategory", "subjectId");
