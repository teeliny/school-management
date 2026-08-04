-- AlterTable
ALTER TABLE "assessment_components" ALTER COLUMN "inputOpensAt" DROP NOT NULL,
ALTER COLUMN "inputClosesAt" DROP NOT NULL,
ALTER COLUMN "publishAt" DROP NOT NULL;
