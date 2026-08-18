import { PartialType } from "@nestjs/mapped-types";
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID } from "class-validator";
import { SkillCategory } from "@prisma/client";

export class CreateSkillAssessmentItemDto {
  @IsUUID()
  academicSessionId!: string;

  @IsEnum(SkillCategory)
  category!: SkillCategory;

  @IsString()
  name!: string;

  @IsInt()
  order!: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateSkillAssessmentItemDto extends PartialType(CreateSkillAssessmentItemDto) {}
