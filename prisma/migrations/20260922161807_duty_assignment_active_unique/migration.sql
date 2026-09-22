-- DropIndex
DROP INDEX "duty_assignments_weekStartDate_classLevelCategoryGroup_staf_key";

-- CreateIndex
CREATE INDEX "duty_assignments_weekStartDate_classLevelCategoryGroup_staf_idx" ON "duty_assignments"("weekStartDate", "classLevelCategoryGroup", "staffId");

-- Prevents duplicate *non-rejected* duty assignments for the same
-- staff+week+group. Scoped to approvalStatus != 'REJECTED' (not a plain
-- unique) so a rejected roster's rows — kept, not deleted, for their audit
-- trail/rejection reason — don't block a regenerate that reuses the same
-- (week, group, staff) triple, which is routine since both the AI solver
-- and the manual round-robin draw from the same staff pool every run.
-- Same precedent as staff_assignments_active_subject_arm_unique.
CREATE UNIQUE INDEX "duty_assignments_active_unique"
  ON "duty_assignments" ("weekStartDate", "classLevelCategoryGroup", "staffId")
  WHERE "approvalStatus" != 'REJECTED';
