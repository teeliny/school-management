-- AlterTable
ALTER TABLE "term_report_cards" ADD COLUMN     "verificationTokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "term_report_cards_verificationTokenHash_key" ON "term_report_cards"("verificationTokenHash");
