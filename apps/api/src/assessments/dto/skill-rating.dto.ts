import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";
import { SkillRatingValue } from "@prisma/client";

export class CreateSkillRatingDto {
  @IsUUID()
  studentId!: string;

  @IsUUID()
  termId!: string;

  @IsUUID()
  skillAssessmentItemId!: string;

  // Exactly one of rating/rangeText is required, per the target
  // SkillAssessmentItem's valueType — validated in SkillRatingService.rate,
  // not here, same "depends on another row's value" shape as
  // ClassSubject.departmentId.
  @IsOptional()
  @IsEnum(SkillRatingValue)
  rating?: SkillRatingValue;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  rangeText?: string;
}
