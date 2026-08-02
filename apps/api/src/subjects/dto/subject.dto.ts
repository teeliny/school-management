import { PartialType } from "@nestjs/mapped-types";
import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from "class-validator";
import { SubjectType } from "@prisma/client";

export class CreateSubjectDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsEnum(SubjectType)
  type!: SubjectType;

  // Required when type=DEPARTMENT, rejected otherwise (PRD §3.3) — validated
  // in SubjectService, not here, since it depends on another field's value.
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsBoolean()
  requiresCalculation?: boolean;
}

export class UpdateSubjectDto extends PartialType(CreateSubjectDto) {}

export class CreateSubjectGroupChildDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsNumber()
  weight!: number;
}

// Composite create path for a grouped subject (PRD §3.3's "Basic Science and
// Technology" example): one parent + N independently-scored children, each
// with its aggregation weight — created in a single transaction.
export class CreateSubjectGroupDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsEnum(SubjectType)
  type!: SubjectType;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsBoolean()
  requiresCalculation?: boolean;

  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => CreateSubjectGroupChildDto)
  children!: CreateSubjectGroupChildDto[];
}
