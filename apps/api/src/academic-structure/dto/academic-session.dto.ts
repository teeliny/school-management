import { PartialType } from "@nestjs/mapped-types";
import { Type } from "class-transformer";
import { IsDate, IsString } from "class-validator";

export class CreateAcademicSessionDto {
  @IsString() name!: string;

  @Type(() => Date)
  @IsDate()
  startDate!: Date;

  @Type(() => Date)
  @IsDate()
  endDate!: Date;
}

export class UpdateAcademicSessionDto extends PartialType(CreateAcademicSessionDto) {}
