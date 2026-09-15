-- AlterTable
ALTER TABLE "receipts" ADD COLUMN     "academicSessionId" TEXT,
ADD COLUMN     "sequenceNumber" INTEGER,
ADD COLUMN     "serialNumber" TEXT;

-- CreateTable
CREATE TABLE "receipt_sequences" (
    "academicSessionId" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "receipt_sequences_pkey" PRIMARY KEY ("academicSessionId")
);

-- CreateIndex
CREATE UNIQUE INDEX "receipts_serialNumber_key" ON "receipts"("serialNumber");

-- CreateIndex
CREATE INDEX "receipts_academicSessionId_sequenceNumber_idx" ON "receipts"("academicSessionId", "sequenceNumber");

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_academicSessionId_fkey" FOREIGN KEY ("academicSessionId") REFERENCES "academic_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_sequences" ADD CONSTRAINT "receipt_sequences_academicSessionId_fkey" FOREIGN KEY ("academicSessionId") REFERENCES "academic_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
