-- CreateEnum
CREATE TYPE "SkillAssessmentItemValueType" AS ENUM ('RATING', 'RANGE_TEXT');

-- AlterTable
ALTER TABLE "skill_assessment_items" ADD COLUMN     "valueType" "SkillAssessmentItemValueType" NOT NULL DEFAULT 'RATING';

-- AlterTable
ALTER TABLE "skill_ratings" ADD COLUMN     "rangeText" TEXT,
ALTER COLUMN "rating" DROP NOT NULL;

-- CreateTable
CREATE TABLE "skill_assessment_item_class_level_categories" (
    "id" TEXT NOT NULL,
    "skillAssessmentItemId" TEXT NOT NULL,
    "classLevelCategory" "ClassLevelCategory" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_assessment_item_class_level_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "skill_assessment_item_class_level_categories_skillAssessmen_key" ON "skill_assessment_item_class_level_categories"("skillAssessmentItemId", "classLevelCategory");

-- AddForeignKey
ALTER TABLE "skill_assessment_item_class_level_categories" ADD CONSTRAINT "skill_assessment_item_class_level_categories_skillAssessme_fkey" FOREIGN KEY ("skillAssessmentItemId") REFERENCES "skill_assessment_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
