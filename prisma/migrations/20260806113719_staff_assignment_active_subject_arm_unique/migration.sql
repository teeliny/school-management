-- Prevents duplicate *active* SUBJECT_TEACHER assignments for the same
-- staff+subject+classArm+session. Scoped to isActive=true (not a plain
-- unique) so historical revoke/reassign rows for the same key don't block
-- the constraint from applying.
CREATE UNIQUE INDEX "staff_assignments_active_subject_arm_unique"
  ON "staff_assignments" ("staffId", "subjectId", "classArmId", "academicSessionId", "assignmentType")
  WHERE "isActive" = true;
