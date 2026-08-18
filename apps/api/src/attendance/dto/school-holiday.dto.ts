import { PartialType } from "@nestjs/mapped-types";
import { Type } from "class-transformer";
import { IsDate, IsOptional, IsString, IsUUID } from "class-validator";

export class CreateSchoolHolidayDto {
  @IsString()
  name!: string;

  @Type(() => Date)
  @IsDate()
  date!: Date;

  @IsOptional()
  @IsUUID()
  academicSessionId?: string;

  @IsOptional()
  @IsUUID()
  termId?: string;
}

export class UpdateSchoolHolidayDto extends PartialType(CreateSchoolHolidayDto) {}
