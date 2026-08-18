import { IsUUID } from "class-validator";

// BUILD_PLAN.md §9 Step 6e: examScheduleId/role are deliberately absent —
// structural, not editable via the grid; only who holds the fixed slot
// changes.
export class UpdateInvigilationAssignmentDto {
  @IsUUID()
  staffId!: string;
}
