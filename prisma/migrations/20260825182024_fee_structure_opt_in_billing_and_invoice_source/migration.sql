-- CreateEnum
CREATE TYPE "InvoiceSource" AS ENUM ('REGULAR', 'SUPPLEMENTARY');

-- DropIndex
DROP INDEX "invoices_studentId_termId_key";

-- AlterTable
ALTER TABLE "fee_structure_student_assignments" ADD COLUMN     "invoiceId" TEXT,
ADD COLUMN     "recordedByStaffId" TEXT;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "source" "InvoiceSource" NOT NULL DEFAULT 'REGULAR';

-- CreateIndex
CREATE INDEX "invoices_studentId_termId_idx" ON "invoices"("studentId", "termId");

-- Hand-added (Prisma's @@unique can't express a WHERE clause): enforces "at
-- most one REGULAR invoice per student per term" while allowing any number
-- of SUPPLEMENTARY invoices — same partial-unique-index pattern as
-- StaffAssignment's WHERE "isActive" = true index.
CREATE UNIQUE INDEX "invoices_regular_per_student_term" ON "invoices"("studentId", "termId") WHERE "source" = 'REGULAR';

-- AddForeignKey
ALTER TABLE "fee_structure_student_assignments" ADD CONSTRAINT "fee_structure_student_assignments_recordedByStaffId_fkey" FOREIGN KEY ("recordedByStaffId") REFERENCES "staff_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structure_student_assignments" ADD CONSTRAINT "fee_structure_student_assignments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
