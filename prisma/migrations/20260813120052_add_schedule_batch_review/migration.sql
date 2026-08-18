-- AlterTable
ALTER TABLE "duty_assignments" ADD COLUMN     "scheduleGenerationRequestId" TEXT;

-- AlterTable
ALTER TABLE "exam_schedules" ADD COLUMN     "scheduleGenerationRequestId" TEXT;

-- AlterTable
ALTER TABLE "invigilation_assignments" ADD COLUMN     "scheduleGenerationRequestId" TEXT;

-- AlterTable
ALTER TABLE "schedule_generation_requests" ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "reviewStatus" "TimetableApprovalStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedByUserId" TEXT;

-- AlterTable
ALTER TABLE "timetable_slots" ADD COLUMN     "scheduleGenerationRequestId" TEXT;

-- CreateIndex
CREATE INDEX "duty_assignments_scheduleGenerationRequestId_idx" ON "duty_assignments"("scheduleGenerationRequestId");

-- CreateIndex
CREATE INDEX "exam_schedules_scheduleGenerationRequestId_idx" ON "exam_schedules"("scheduleGenerationRequestId");

-- CreateIndex
CREATE INDEX "invigilation_assignments_scheduleGenerationRequestId_idx" ON "invigilation_assignments"("scheduleGenerationRequestId");

-- CreateIndex
CREATE INDEX "timetable_slots_scheduleGenerationRequestId_idx" ON "timetable_slots"("scheduleGenerationRequestId");

-- AddForeignKey
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_scheduleGenerationRequestId_fkey" FOREIGN KEY ("scheduleGenerationRequestId") REFERENCES "schedule_generation_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_generation_requests" ADD CONSTRAINT "schedule_generation_requests_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_schedules" ADD CONSTRAINT "exam_schedules_scheduleGenerationRequestId_fkey" FOREIGN KEY ("scheduleGenerationRequestId") REFERENCES "schedule_generation_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invigilation_assignments" ADD CONSTRAINT "invigilation_assignments_scheduleGenerationRequestId_fkey" FOREIGN KEY ("scheduleGenerationRequestId") REFERENCES "schedule_generation_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duty_assignments" ADD CONSTRAINT "duty_assignments_scheduleGenerationRequestId_fkey" FOREIGN KEY ("scheduleGenerationRequestId") REFERENCES "schedule_generation_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
