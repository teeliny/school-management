import { PartialType } from "@nestjs/mapped-types";
import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";

export class CreateSubjectDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  code!: string;

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

  @IsOptional()
  @IsBoolean()
  requiresCalculation?: boolean;

  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => CreateSubjectGroupChildDto)
  children!: CreateSubjectGroupChildDto[];
}
