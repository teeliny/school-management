import { PartialType } from "@nestjs/mapped-types";
import { DepartmentName } from "@prisma/client";
import { IsEnum, IsOptional, IsString } from "class-validator";

export class CreateDepartmentDto {
  @IsEnum(DepartmentName) name!: DepartmentName;
  @IsOptional() @IsString() description?: string;
}

export class UpdateDepartmentDto extends PartialType(CreateDepartmentDto) {}
