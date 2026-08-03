import { PartialType } from "@nestjs/mapped-types";
import { Type } from "class-transformer";
import { IsDate, IsEnum, IsInt, IsNumber, IsString, IsUUID, Min } from "class-validator";
import { AssessmentComponentType } from "@prisma/client";

export class CreateAssessmentComponentDto {
  @IsUUID()
  termId!: string;

  @IsUUID()
  classLevelId!: string;

  @IsEnum(AssessmentComponentType)
  type!: AssessmentComponentType;

  @IsString()
  name!: string;

  @IsInt()
  @Min(1)
  sequence!: number;

  @IsNumber()
  maxScore!: number;

  @Type(() => Date)
  @IsDate()
  inputOpensAt!: Date;

  @Type(() => Date)
  @IsDate()
  inputClosesAt!: Date;

  @Type(() => Date)
  @IsDate()
  publishAt!: Date;
}

export class UpdateAssessmentComponentDto extends PartialType(CreateAssessmentComponentDto) {}
