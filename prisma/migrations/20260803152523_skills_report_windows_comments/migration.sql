-- CreateEnum
CREATE TYPE "SkillCategory" AS ENUM ('PSYCHOMOTOR', 'AFFECTIVE_COGNITIVE');

-- CreateEnum
CREATE TYPE "SkillRatingValue" AS ENUM ('EXCELLENT', 'VERY_GOOD', 'GOOD', 'FAIR', 'POOR');

-- CreateEnum
CREATE TYPE "ReportWindowStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ReportCommentType" AS ENUM ('SUBJECT', 'CLASS_TEACHER', 'PRINCIPAL');

-- CreateTable
CREATE TABLE "skill_assessment_items" (
    "id" TEXT NOT NULL,
    "academicSessionId" TEXT NOT NULL,
    "category" "SkillCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_assessment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_ratings" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "skillAssessmentItemId" TEXT NOT NULL,
    "rating" "SkillRatingValue" NOT NULL,
    "ratedByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skill_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_windows" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "classLevelId" TEXT NOT NULL,
    "inputOpensAt" TIMESTAMP(3) NOT NULL,
    "inputClosesAt" TIMESTAMP(3) NOT NULL,
    "status" "ReportWindowStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_comments" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "commentType" "ReportCommentType" NOT NULL,
    "subjectId" TEXT,
    "authorStaffId" TEXT,
    "comment" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "skill_assessment_items_academicSessionId_category_name_key" ON "skill_assessment_items"("academicSessionId", "category", "name");

-- CreateIndex
CREATE UNIQUE INDEX "skill_ratings_studentId_termId_skillAssessmentItemId_key" ON "skill_ratings"("studentId", "termId", "skillAssessmentItemId");

-- CreateIndex
CREATE UNIQUE INDEX "report_windows_termId_classLevelId_key" ON "report_windows"("termId", "classLevelId");

-- CreateIndex
CREATE UNIQUE INDEX "report_comments_studentId_termId_commentType_subjectId_key" ON "report_comments"("studentId", "termId", "commentType", "subjectId");

-- The plain unique index above only protects the SUBJECT case (non-null
-- subjectId) — Postgres treats every NULL as distinct, so it would happily
-- allow duplicate CLASS_TEACHER/PRINCIPAL rows (subjectId always NULL for
-- those) otherwise. Hand-added partial index, same precedent as the
-- SUPER_ADMIN singleton / AcademicSession.isCurrent indexes (Prisma's DSL
-- can't express a WHERE clause on a unique index).
CREATE UNIQUE INDEX "report_comments_class_teacher_principal_unique" ON "report_comments"("studentId", "termId", "commentType") WHERE "subjectId" IS NULL;

-- AddForeignKey
ALTER TABLE "skill_assessment_items" ADD CONSTRAINT "skill_assessment_items_academicSessionId_fkey" FOREIGN KEY ("academicSessionId") REFERENCES "academic_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_ratings" ADD CONSTRAINT "skill_ratings_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "student_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_ratings" ADD CONSTRAINT "skill_ratings_termId_fkey" FOREIGN KEY ("termId") REFERENCES "terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_ratings" ADD CONSTRAINT "skill_ratings_skillAssessmentItemId_fkey" FOREIGN KEY ("skillAssessmentItemId") REFERENCES "skill_assessment_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_ratings" ADD CONSTRAINT "skill_ratings_ratedByStaffId_fkey" FOREIGN KEY ("ratedByStaffId") REFERENCES "staff_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_windows" ADD CONSTRAINT "report_windows_termId_fkey" FOREIGN KEY ("termId") REFERENCES "terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_windows" ADD CONSTRAINT "report_windows_classLevelId_fkey" FOREIGN KEY ("classLevelId") REFERENCES "class_levels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_windows" ADD CONSTRAINT "report_windows_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_comments" ADD CONSTRAINT "report_comments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "student_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_comments" ADD CONSTRAINT "report_comments_termId_fkey" FOREIGN KEY ("termId") REFERENCES "terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_comments" ADD CONSTRAINT "report_comments_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_comments" ADD CONSTRAINT "report_comments_authorStaffId_fkey" FOREIGN KEY ("authorStaffId") REFERENCES "staff_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
