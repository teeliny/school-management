-- CreateTable
CREATE TABLE "duty_assignments" (
    "id" TEXT NOT NULL,
    "weekStartDate" DATE NOT NULL,
    "classLevelCategoryGroup" "ClassLevelCategoryGroup" NOT NULL,
    "staffId" TEXT NOT NULL,
    "generatedBy" "TimetableGeneratedBy" NOT NULL DEFAULT 'MANUAL',
    "approvalStatus" "TimetableApprovalStatus" NOT NULL DEFAULT 'APPROVED',
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "duty_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "duty_assignments_staffId_idx" ON "duty_assignments"("staffId");

-- CreateIndex
CREATE UNIQUE INDEX "duty_assignments_weekStartDate_classLevelCategoryGroup_staf_key" ON "duty_assignments"("weekStartDate", "classLevelCategoryGroup", "staffId");

-- AddForeignKey
ALTER TABLE "duty_assignments" ADD CONSTRAINT "duty_assignments_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duty_assignments" ADD CONSTRAINT "duty_assignments_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
