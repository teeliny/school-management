-- AlterTable
ALTER TABLE "term_report_cards" ADD COLUMN     "needsRegeneration" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "staleReason" TEXT,
ADD COLUMN     "staleSince" TIMESTAMP(3);
