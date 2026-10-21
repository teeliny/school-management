import { Type } from "class-transformer";
import { IsArray, IsEnum, IsIn, IsInt, IsOptional, IsUUID, Max, Min, ValidateNested } from "class-validator";
import { SkillRatingValue } from "@prisma/client";

export class SuggestionSkillRatingDto {
  @IsUUID()
  skillAssessmentItemId!: string;

  @IsEnum(SkillRatingValue)
  rating!: SkillRatingValue;
}

export class CommentSuggestionDto {
  @IsUUID()
  studentId!: string;

  @IsUUID()
  termId!: string;

  @IsIn(["CLASS_TEACHER", "PRINCIPAL"])
  commentType!: "CLASS_TEACHER" | "PRINCIPAL";

  // CLASS_TEACHER only: the ratings currently in the form, which may not be
  // saved yet. When omitted, the student's saved SkillRatings are used.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SuggestionSkillRatingDto)
  skillRatings?: SuggestionSkillRatingDto[];

  // Bumped by the UI's "Regenerate" button. The same attempt gives the same
  // template picks.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  attempt?: number;
}
