import { PartialType } from "@nestjs/mapped-types";
import { Type } from "class-transformer";
import { IsDate, IsString, IsUUID } from "class-validator";

export class CreateTermDto {
  @IsUUID() academicSessionId!: string;
  @IsString() name!: string;

  @Type(() => Date)
  @IsDate()
  startDate!: Date;

  @Type(() => Date)
  @IsDate()
  endDate!: Date;
}

export class UpdateTermDto extends PartialType(CreateTermDto) {}
