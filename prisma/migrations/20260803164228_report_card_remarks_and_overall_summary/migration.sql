-- AlterTable
ALTER TABLE "subject_term_results" ADD COLUMN     "remark" TEXT;

-- AlterTable
ALTER TABLE "term_report_cards" ADD COLUMN     "overallGrade" TEXT,
ADD COLUMN     "overallRemark" TEXT,
ADD COLUMN     "overallScore" DECIMAL(5,2);
