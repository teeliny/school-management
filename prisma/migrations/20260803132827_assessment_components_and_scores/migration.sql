-- CreateEnum
CREATE TYPE "AssessmentComponentType" AS ENUM ('CA', 'MID_TERM', 'EXAM');

-- CreateEnum
CREATE TYPE "AssessmentComponentStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'PUBLISHED');

-- CreateTable
CREATE TABLE "assessment_components" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "classLevelId" TEXT NOT NULL,
    "type" "AssessmentComponentType" NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "maxScore" DECIMAL(5,2) NOT NULL,
    "inputOpensAt" TIMESTAMP(3) NOT NULL,
    "inputClosesAt" TIMESTAMP(3) NOT NULL,
    "publishAt" TIMESTAMP(3) NOT NULL,
    "status" "AssessmentComponentStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_entries" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "assessmentComponentId" TEXT NOT NULL,
    "classArmId" TEXT NOT NULL,
    "score" DECIMAL(5,2) NOT NULL,
    "enteredByStaffId" TEXT NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "score_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assessment_components_termId_classLevelId_type_sequence_key" ON "assessment_components"("termId", "classLevelId", "type", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "score_entries_studentId_subjectId_assessmentComponentId_key" ON "score_entries"("studentId", "subjectId", "assessmentComponentId");

-- AddForeignKey
ALTER TABLE "assessment_components" ADD CONSTRAINT "assessment_components_termId_fkey" FOREIGN KEY ("termId") REFERENCES "terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_components" ADD CONSTRAINT "assessment_components_classLevelId_fkey" FOREIGN KEY ("classLevelId") REFERENCES "class_levels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_components" ADD CONSTRAINT "assessment_components_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_entries" ADD CONSTRAINT "score_entries_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "student_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_entries" ADD CONSTRAINT "score_entries_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_entries" ADD CONSTRAINT "score_entries_assessmentComponentId_fkey" FOREIGN KEY ("assessmentComponentId") REFERENCES "assessment_components"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_entries" ADD CONSTRAINT "score_entries_classArmId_fkey" FOREIGN KEY ("classArmId") REFERENCES "class_arms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_entries" ADD CONSTRAINT "score_entries_enteredByStaffId_fkey" FOREIGN KEY ("enteredByStaffId") REFERENCES "staff_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
