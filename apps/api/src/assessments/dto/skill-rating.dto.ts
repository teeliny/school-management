import { IsEnum, IsUUID } from "class-validator";
import { SkillRatingValue } from "@prisma/client";

export class CreateSkillRatingDto {
  @IsUUID()
  studentId!: string;

  @IsUUID()
  termId!: string;

  @IsUUID()
  skillAssessmentItemId!: string;

  @IsEnum(SkillRatingValue)
  rating!: SkillRatingValue;
}
