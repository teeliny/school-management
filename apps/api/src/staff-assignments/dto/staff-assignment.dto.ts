import { AssignmentType } from "@prisma/client";
import { Type } from "class-transformer";
import { ArrayUnique, IsArray, IsBoolean, IsDate, IsEnum, IsOptional, IsUUID } from "class-validator";

export class CreateStaffAssignmentDto {
  @IsUUID()
  staffId!: string;

  @IsEnum(AssignmentType)
  assignmentType!: AssignmentType;

  @IsOptional()
  @IsUUID()
  classArmId?: string;

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

export class SyncSubjectTeacherAssignmentsDto {
  @IsUUID()
  staffId!: string;

  @IsUUID()
  subjectId!: string;

  @IsUUID()
  academicSessionId!: string;

  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  classArmIds!: string[];

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startDate?: Date;
}
