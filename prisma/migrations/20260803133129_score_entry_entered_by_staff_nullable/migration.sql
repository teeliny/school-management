-- DropForeignKey
ALTER TABLE "score_entries" DROP CONSTRAINT "score_entries_enteredByStaffId_fkey";

-- AlterTable
ALTER TABLE "score_entries" ALTER COLUMN "enteredByStaffId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "score_entries" ADD CONSTRAINT "score_entries_enteredByStaffId_fkey" FOREIGN KEY ("enteredByStaffId") REFERENCES "staff_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
