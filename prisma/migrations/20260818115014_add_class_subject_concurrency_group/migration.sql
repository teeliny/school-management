-- AlterTable
ALTER TABLE "class_subjects" ADD COLUMN     "concurrencyGroupId" TEXT;

-- CreateTable
CREATE TABLE "class_subject_concurrency_groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "classLevelCategory" "ClassLevelCategory" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_subject_concurrency_groups_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_concurrencyGroupId_fkey" FOREIGN KEY ("concurrencyGroupId") REFERENCES "class_subject_concurrency_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
