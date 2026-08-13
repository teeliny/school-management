-- AlterTable
ALTER TABLE "duty_assignments" ADD COLUMN     "rejectionReason" TEXT;

-- AlterTable
ALTER TABLE "exam_schedules" ADD COLUMN     "rejectionReason" TEXT;

-- AlterTable
ALTER TABLE "invigilation_assignments" ADD COLUMN     "rejectionReason" TEXT;

-- AlterTable
ALTER TABLE "timetable_slots" ADD COLUMN     "rejectionReason" TEXT;
