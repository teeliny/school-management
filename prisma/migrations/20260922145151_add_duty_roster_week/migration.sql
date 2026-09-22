-- AlterTable
ALTER TABLE "duty_assignments" ADD COLUMN     "dutyRosterWeekId" TEXT;

-- CreateTable
CREATE TABLE "duty_roster_weeks" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "classLevelCategoryGroup" "ClassLevelCategoryGroup" NOT NULL,
    "weekStartDate" DATE NOT NULL,
    "topic" TEXT,
    "isBreak" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "duty_roster_weeks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "duty_roster_weeks_termId_classLevelCategoryGroup_weekStartD_key" ON "duty_roster_weeks"("termId", "classLevelCategoryGroup", "weekStartDate");

-- CreateIndex
CREATE INDEX "duty_assignments_dutyRosterWeekId_idx" ON "duty_assignments"("dutyRosterWeekId");

-- AddForeignKey
ALTER TABLE "duty_assignments" ADD CONSTRAINT "duty_assignments_dutyRosterWeekId_fkey" FOREIGN KEY ("dutyRosterWeekId") REFERENCES "duty_roster_weeks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duty_roster_weeks" ADD CONSTRAINT "duty_roster_weeks_termId_fkey" FOREIGN KEY ("termId") REFERENCES "terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
