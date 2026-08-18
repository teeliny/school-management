
-- CreateEnum
CREATE TYPE "InvigilationRole" AS ENUM ('LEAD', 'ASSISTANT');

-- CreateTable
CREATE TABLE "invigilation_assignments" (
    "id" TEXT NOT NULL,
    "examScheduleId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "role" "InvigilationRole" NOT NULL,
    "generatedBy" "TimetableGeneratedBy" NOT NULL DEFAULT 'MANUAL',
    "approvalStatus" "TimetableApprovalStatus" NOT NULL DEFAULT 'APPROVED',
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invigilation_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invigilation_assignments_staffId_idx" ON "invigilation_assignments"("staffId");

-- CreateIndex
CREATE UNIQUE INDEX "invigilation_assignments_examScheduleId_role_key" ON "invigilation_assignments"("examScheduleId", "role");

-- AddForeignKey
ALTER TABLE "invigilation_assignments" ADD CONSTRAINT "invigilation_assignments_examScheduleId_fkey" FOREIGN KEY ("examScheduleId") REFERENCES "exam_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invigilation_assignments" ADD CONSTRAINT "invigilation_assignments_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invigilation_assignments" ADD CONSTRAINT "invigilation_assignments_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

