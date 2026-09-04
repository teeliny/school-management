-- CreateEnum
CREATE TYPE "SkillGroupValueType" AS ENUM ('RATING', 'RANGE_TEXT');

-- CreateTable
CREATE TABLE "skill_groups" (
    "id" TEXT NOT NULL,
    "academicSessionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "valueType" "SkillGroupValueType" NOT NULL DEFAULT 'RATING',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_group_class_level_categories" (
    "id" TEXT NOT NULL,
    "skillGroupId" TEXT NOT NULL,
    "classLevelCategory" "ClassLevelCategory" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_group_class_level_categories_pkey" PRIMARY KEY ("id")
);

-- Data backfill: replaces the old fixed PSYCHOMOTOR/AFFECTIVE_COGNITIVE
-- SkillCategory enum with an Admin-defined SkillGroup per (session, old
-- category) pair — one generically-named group per pair, so any pre-existing
-- SkillAssessmentItem row has somewhere to point its new required groupId at
-- without losing data. A deployment with no skill_assessment_items rows yet
-- (the common case) just does nothing here.
INSERT INTO "skill_groups" ("id", "academicSessionId", "name", "order", "valueType", "isActive", "createdAt")
SELECT
    gen_random_uuid()::text,
    sub."academicSessionId",
    CASE sub."category" WHEN 'PSYCHOMOTOR' THEN 'Psychomotor Skills' ELSE 'Affective/Cognitive Skills' END,
    CASE sub."category" WHEN 'PSYCHOMOTOR' THEN 1 ELSE 2 END,
    'RATING',
    true,
    CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "academicSessionId", "category" FROM "skill_assessment_items") sub;

-- AlterTable
ALTER TABLE "skill_assessment_items" ADD COLUMN "groupId" TEXT;

UPDATE "skill_assessment_items" sai
SET "groupId" = sg."id"
FROM "skill_groups" sg
WHERE sg."academicSessionId" = sai."academicSessionId"
  AND sg."name" = CASE sai."category" WHEN 'PSYCHOMOTOR' THEN 'Psychomotor Skills' ELSE 'Affective/Cognitive Skills' END;

ALTER TABLE "skill_assessment_items" ALTER COLUMN "groupId" SET NOT NULL;

-- DropForeignKey
ALTER TABLE "skill_assessment_item_class_level_categories" DROP CONSTRAINT "skill_assessment_item_class_level_categories_skillAssessme_fkey";

-- DropIndex
DROP INDEX "skill_assessment_items_academicSessionId_category_name_key";

-- AlterTable
ALTER TABLE "skill_assessment_items" DROP COLUMN "category",
DROP COLUMN "valueType";

-- DropTable
DROP TABLE "skill_assessment_item_class_level_categories";

-- DropEnum
DROP TYPE "SkillAssessmentItemValueType";

-- DropEnum
DROP TYPE "SkillCategory";

-- CreateIndex
CREATE UNIQUE INDEX "skill_groups_academicSessionId_name_key" ON "skill_groups"("academicSessionId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "skill_group_class_level_categories_skillGroupId_classLevelC_key" ON "skill_group_class_level_categories"("skillGroupId", "classLevelCategory");

-- CreateIndex
CREATE UNIQUE INDEX "skill_assessment_items_groupId_name_key" ON "skill_assessment_items"("groupId", "name");

-- AddForeignKey
ALTER TABLE "skill_groups" ADD CONSTRAINT "skill_groups_academicSessionId_fkey" FOREIGN KEY ("academicSessionId") REFERENCES "academic_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_group_class_level_categories" ADD CONSTRAINT "skill_group_class_level_categories_skillGroupId_fkey" FOREIGN KEY ("skillGroupId") REFERENCES "skill_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_assessment_items" ADD CONSTRAINT "skill_assessment_items_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "skill_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
