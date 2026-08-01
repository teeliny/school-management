import { StaffCategory, StaffStatus } from "@prisma/client";
import { Type } from "class-transformer";
import { IsDate, IsEnum, IsOptional, IsString } from "class-validator";

export class UpdateStaffProfileDto {
  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsOptional()
  @IsEnum(StaffCategory)
  staffCategory?: StaffCategory;

  @IsOptional()
  @IsString()
  department?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  employmentDate?: Date;

  @IsOptional()
  @IsString()
  qualification?: string;

  @IsOptional()
  @IsEnum(StaffStatus)
  status?: StaffStatus;
}
