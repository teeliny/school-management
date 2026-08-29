-- AlterTable
ALTER TABLE "discount_requests" ADD COLUMN     "feeStructureId" TEXT;

-- AddForeignKey
ALTER TABLE "discount_requests" ADD CONSTRAINT "discount_requests_feeStructureId_fkey" FOREIGN KEY ("feeStructureId") REFERENCES "fee_structures"("id") ON DELETE SET NULL ON UPDATE CASCADE;
