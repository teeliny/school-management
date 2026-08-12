-- CreateEnum
CREATE TYPE "ScheduleScope" AS ENUM ('CLASS_TIMETABLE', 'EXAM_TIMETABLE', 'INVIGILATION', 'WEEKLY_DUTY');

-- CreateEnum
CREATE TYPE "ScheduleGenerationStatus" AS ENUM ('QUEUED', 'SOLVING', 'COMPLETED', 'FAILED', 'TIMED_OUT');

-- CreateEnum
CREATE TYPE "ClassLevelCategoryGroup" AS ENUM ('JSS_SSS', 'CRECHE_NURSERY_PRIMARY');

-- CreateTable
CREATE TABLE "scheduling_constraints" (
    "id" TEXT NOT NULL,
    "scope" "ScheduleScope" NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduling_constraints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_generation_requests" (
    "id" TEXT NOT NULL,
    "scope" "ScheduleScope" NOT NULL,
    "classArmId" TEXT,
    "assessmentComponentId" TEXT,
    "termId" TEXT,
    "classLevelCategoryGroup" "ClassLevelCategoryGroup",
    "parameters" JSONB,
    "status" "ScheduleGenerationStatus" NOT NULL DEFAULT 'QUEUED',
    "callbackToken" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "schedule_generation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "scheduling_constraints_scope_key_key" ON "scheduling_constraints"("scope", "key");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_generation_requests_callbackToken_key" ON "schedule_generation_requests"("callbackToken");

-- CreateIndex
CREATE INDEX "schedule_generation_requests_status_idx" ON "schedule_generation_requests"("status");

-- AddForeignKey
ALTER TABLE "schedule_generation_requests" ADD CONSTRAINT "schedule_generation_requests_classArmId_fkey" FOREIGN KEY ("classArmId") REFERENCES "class_arms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_generation_requests" ADD CONSTRAINT "schedule_generation_requests_assessmentComponentId_fkey" FOREIGN KEY ("assessmentComponentId") REFERENCES "assessment_components"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_generation_requests" ADD CONSTRAINT "schedule_generation_requests_termId_fkey" FOREIGN KEY ("termId") REFERENCES "terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_generation_requests" ADD CONSTRAINT "schedule_generation_requests_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
