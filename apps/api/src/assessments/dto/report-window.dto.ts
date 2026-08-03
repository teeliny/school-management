import { PartialType } from "@nestjs/mapped-types";
import { Type } from "class-transformer";
import { IsDate, IsUUID } from "class-validator";

export class CreateReportWindowDto {
  @IsUUID()
  termId!: string;

  @IsUUID()
  classLevelId!: string;

  @Type(() => Date)
  @IsDate()
  inputOpensAt!: Date;

  @Type(() => Date)
  @IsDate()
  inputClosesAt!: Date;
}

export class UpdateReportWindowDto extends PartialType(CreateReportWindowDto) {}
