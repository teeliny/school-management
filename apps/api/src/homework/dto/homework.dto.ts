import { Type } from "class-transformer";
import { IsBoolean, IsDate, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from "class-validator";

export class CreateHomeworkDto {
  @IsUUID()
  subjectId!: string;

  @IsUUID()
  classArmId!: string;

  @IsUUID()
  termId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsString()
  @IsNotEmpty()
  instructions!: string;

  @Type(() => Date)
  @IsDate()
  dueDate!: Date;

  // Omitted/null = "marked" only, no number. Required (checked in the
  // service) whenever caComponentId is set.
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxScore?: number | null;

  @IsOptional()
  @IsBoolean()
  allowOnlineSubmission?: boolean;

  // Optional CA-type AssessmentComponent to count this homework toward —
  // same term, same class-level category as classArmId (service-checked).
  @IsOptional()
  @IsUUID()
  caComponentId?: string | null;
}

// Every field optional; an explicit null clears maxScore/caComponentId
// (undefined leaves it unchanged). subjectId/classArmId/termId are fixed
// once created — delete and recreate instead.
export class UpdateHomeworkDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  instructions?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dueDate?: Date;

  @IsOptional()
  @IsNumber()
  @Min(1)
  maxScore?: number | null;

  @IsOptional()
  @IsBoolean()
  allowOnlineSubmission?: boolean;

  @IsOptional()
  @IsUUID()
  caComponentId?: string | null;
}

export class MarkHomeworkDto {
  // Required when the homework has a maxScore, rejected when it doesn't —
  // checked in the service against the loaded homework.
  @IsOptional()
  @IsNumber()
  @Min(0)
  score?: number | null;

  @IsOptional()
  @IsString()
  correction?: string | null;
}

export class SubmitHomeworkDto {
  @IsOptional()
  @IsString()
  text?: string | null;
}
