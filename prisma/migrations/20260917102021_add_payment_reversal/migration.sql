-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_REVERSED';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "reversalReason" TEXT,
ADD COLUMN     "reversedAt" TIMESTAMP(3),
ADD COLUMN     "reversedByUserId" TEXT;
