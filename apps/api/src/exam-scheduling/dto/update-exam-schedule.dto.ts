import { IsDate, IsOptional, IsString, IsUUID, Matches } from "class-validator";
import { Type } from "class-transformer";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// BUILD_PLAN.md §9 Step 6d: classArmId/assessmentComponentId are
// deliberately absent — structural, not editable via drag/inline-edit, same
// as TimetableSlot's drag-and-drop never re-parents a slot to a different
// class arm.
export class UpdateExamScheduleDto {
  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  date?: Date;

  @IsOptional()
  @Matches(HHMM, { message: "startTime must be in HH:mm format" })
  startTime?: string;

  @IsOptional()
  @Matches(HHMM, { message: "endTime must be in HH:mm format" })
  endTime?: string;

  @IsOptional()
  @IsString()
  venue?: string;
}
