-- DropForeignKey
ALTER TABLE "attendance_sessions" DROP CONSTRAINT "attendance_sessions_takenByStaffId_fkey";

-- AlterTable
ALTER TABLE "attendance_sessions" ALTER COLUMN "takenByStaffId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_takenByStaffId_fkey" FOREIGN KEY ("takenByStaffId") REFERENCES "staff_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
