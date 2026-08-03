-- CreateEnum
CREATE TYPE "TermReportCardType" AS ENUM ('MID_TERM', 'FULL_TERM');

-- CreateEnum
CREATE TYPE "TermReportCardStatus" AS ENUM ('GENERATING', 'READY', 'PUBLISHED', 'FAILED');

-- CreateTable
CREATE TABLE "grade_scales" (
    "id" TEXT NOT NULL,
    "minScore" DECIMAL(5,2) NOT NULL,
    "maxScore" DECIMAL(5,2) NOT NULL,
    "grade" TEXT NOT NULL,
    "remark" TEXT,
    "gradePoint" DECIMAL(3,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grade_scales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subject_term_results" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "classArmId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "totalScore" DECIMAL(5,2) NOT NULL,
    "grade" TEXT,
    "position" INTEGER,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subject_term_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "term_report_cards" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "reportType" "TermReportCardType" NOT NULL,
    "status" "TermReportCardStatus" NOT NULL DEFAULT 'GENERATING',
    "pdfUrl" TEXT,
    "scoresSnapshot" JSONB,
    "generatedAt" TIMESTAMP(3),
    "generatedByUserId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "term_report_cards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subject_term_results_studentId_subjectId_termId_key" ON "subject_term_results"("studentId", "subjectId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "term_report_cards_studentId_termId_reportType_key" ON "term_report_cards"("studentId", "termId", "reportType");

-- AddForeignKey
ALTER TABLE "subject_term_results" ADD CONSTRAINT "subject_term_results_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "student_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_term_results" ADD CONSTRAINT "subject_term_results_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_term_results" ADD CONSTRAINT "subject_term_results_classArmId_fkey" FOREIGN KEY ("classArmId") REFERENCES "class_arms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_term_results" ADD CONSTRAINT "subject_term_results_termId_fkey" FOREIGN KEY ("termId") REFERENCES "terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "term_report_cards" ADD CONSTRAINT "term_report_cards_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "student_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "term_report_cards" ADD CONSTRAINT "term_report_cards_termId_fkey" FOREIGN KEY ("termId") REFERENCES "terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "term_report_cards" ADD CONSTRAINT "term_report_cards_generatedByUserId_fkey" FOREIGN KEY ("generatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
