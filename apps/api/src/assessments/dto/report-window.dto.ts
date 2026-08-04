import { PartialType } from "@nestjs/mapped-types";
import { Type } from "class-transformer";
import { IsDate, IsEnum, IsUUID } from "class-validator";
import { ClassLevelCategory } from "@prisma/client";

export class CreateReportWindowDto {
  @IsUUID()
  termId!: string;

  @IsEnum(ClassLevelCategory)
  classLevelCategory!: ClassLevelCategory;

  @Type(() => Date)
  @IsDate()
  inputOpensAt!: Date;

  @Type(() => Date)
  @IsDate()
  inputClosesAt!: Date;
}

export class UpdateReportWindowDto extends PartialType(CreateReportWindowDto) {}
