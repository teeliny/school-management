import { AssignmentType } from "@prisma/client";
import { Type } from "class-transformer";
import { IsBoolean, IsDate, IsEnum, IsOptional, IsUUID } from "class-validator";

export class CreateStaffAssignmentDto {
  @IsUUID()
  staffId!: string;

  @IsEnum(AssignmentType)
  assignmentType!: AssignmentType;

  @IsOptional()
  @IsUUID()
  classArmId?: string;

  // No FK/validation yet — Subject doesn't exist until Phase 3 (BUILD_PLAN.md §5).
  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @IsUUID()
  academicSessionId!: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startDate?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endDate?: Date;

  /**
   * PRD FR3.3: two active class teachers on the same ClassArm is rejected by
   * default; this is the "deliberate override" escape hatch, not a DB
   * constraint.
   */
  @IsOptional()
  @IsBoolean()
  allowCoTeaching?: boolean;
}
