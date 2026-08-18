import { PartialType } from "@nestjs/mapped-types";
import { IsNumber, IsOptional, IsString } from "class-validator";

export class CreateGradeScaleDto {
  @IsNumber()
  minScore!: number;

  @IsNumber()
  maxScore!: number;

  @IsString()
  grade!: string;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsOptional()
  @IsNumber()
  gradePoint?: number;
}

export class UpdateGradeScaleDto extends PartialType(CreateGradeScaleDto) {}
