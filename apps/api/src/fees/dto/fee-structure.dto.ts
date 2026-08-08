import { PartialType } from "@nestjs/mapped-types";
import { IsBoolean, IsNumber, IsOptional, IsString, IsUUID, Min } from "class-validator";

export class CreateFeeStructureDto {
  @IsOptional()
  @IsUUID()
  classLevelId?: string;

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
