-- DropIndex
DROP INDEX "invigilation_assignments_examScheduleId_role_key";

-- CreateTable
CREATE TABLE "exam_day_invigilations" (
    "id" TEXT NOT NULL,
    "assessmentComponentId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "staffId" TEXT NOT NULL,
    "generatedBy" "TimetableGeneratedBy" NOT NULL DEFAULT 'MANUAL',
    "approvalStatus" "TimetableApprovalStatus" NOT NULL DEFAULT 'APPROVED',
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "scheduleGenerationRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_day_invigilations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exam_day_invigilations_assessmentComponentId_date_idx" ON "exam_day_invigilations"("assessmentComponentId", "date");

-- CreateIndex
CREATE INDEX "exam_day_invigilations_staffId_date_idx" ON "exam_day_invigilations"("staffId", "date");

-- CreateIndex
CREATE INDEX "exam_day_invigilations_scheduleGenerationRequestId_idx" ON "exam_day_invigilations"("scheduleGenerationRequestId");

-- CreateIndex
CREATE INDEX "invigilation_assignments_examScheduleId_role_idx" ON "invigilation_assignments"("examScheduleId", "role");

-- AddForeignKey
ALTER TABLE "exam_day_invigilations" ADD CONSTRAINT "exam_day_invigilations_assessmentComponentId_fkey" FOREIGN KEY ("assessmentComponentId") REFERENCES "assessment_components"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_day_invigilations" ADD CONSTRAINT "exam_day_invigilations_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_day_invigilations" ADD CONSTRAINT "exam_day_invigilations_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_day_invigilations" ADD CONSTRAINT "exam_day_invigilations_scheduleGenerationRequestId_fkey" FOREIGN KEY ("scheduleGenerationRequestId") REFERENCES "schedule_generation_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-added (Prisma's @@unique can't express a WHERE clause): at most one
-- *non-rejected* LEAD/ASSISTANT per exam paper. Replaces the plain unique
-- dropped above so a REJECTED roster's rows (kept for their audit trail)
-- don't block a regenerate reproducing the same (examScheduleId, role) —
-- same precedent as duty_assignments_active_unique.
CREATE UNIQUE INDEX "invigilation_assignments_active_unique"
  ON "invigilation_assignments" ("examScheduleId", "role")
  WHERE "approvalStatus" != 'REJECTED';

-- At most one non-rejected hall-duty row per staff per day per component.
CREATE UNIQUE INDEX "exam_day_invigilations_active_unique"
  ON "exam_day_invigilations" ("assessmentComponentId", "date", "staffId")
  WHERE "approvalStatus" != 'REJECTED';
