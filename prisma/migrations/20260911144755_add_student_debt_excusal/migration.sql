-- AlterTable
ALTER TABLE "student_profiles" ADD COLUMN     "debtExcusedAt" TIMESTAMP(3),
ADD COLUMN     "debtExcusedByUserId" TEXT,
ADD COLUMN     "debtExcusedReason" TEXT,
ADD COLUMN     "isDebtExcused" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_debtExcusedByUserId_fkey" FOREIGN KEY ("debtExcusedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
