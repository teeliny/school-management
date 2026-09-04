import { PartialType } from "@nestjs/mapped-types";
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID } from "class-validator";

export class CreateSkillAssessmentItemDto {
  @IsUUID()
  academicSessionId!: string;

  @IsUUID()
  groupId!: string;

  @IsString()
  name!: string;

  @IsInt()
  order!: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateSkillAssessmentItemDto extends PartialType(CreateSkillAssessmentItemDto) {}
