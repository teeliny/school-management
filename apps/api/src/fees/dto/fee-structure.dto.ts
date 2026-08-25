import { PartialType } from "@nestjs/mapped-types";
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, IsUUID, Min } from "class-validator";

export class CreateFeeStructureDto {
  // Omitted or empty = school-wide; set = applies only to those class levels.
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  classLevelIds?: string[];

  @IsUUID()
  academicSessionId!: string;

  @IsUUID()
  termId!: string;

  @IsString()
  name!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;
}

export class UpdateFeeStructureDto extends PartialType(CreateFeeStructureDto) {}
