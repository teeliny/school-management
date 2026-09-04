import { PartialType } from "@nestjs/mapped-types";
import { IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID } from "class-validator";
import { ClassLevelCategory, SkillGroupValueType } from "@prisma/client";

export class CreateSkillGroupDto {
  @IsUUID()
  academicSessionId!: string;

  @IsString()
  name!: string;

  @IsInt()
  order!: number;

  @IsOptional()
  @IsEnum(SkillGroupValueType)
  valueType?: SkillGroupValueType;

  // Which ClassLevelCategorys this group applies to — omitted or empty
  // means every category (e.g. "Psychomotor Skills"). A non-empty list
  // restricts it (e.g. Reception's "Numbers" group).
  @IsOptional()
  @IsArray()
  @IsEnum(ClassLevelCategory, { each: true })
  classLevelCategories?: ClassLevelCategory[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateSkillGroupDto extends PartialType(CreateSkillGroupDto) {}
