import { AttendanceGranularity } from "@prisma/client";
import { IsEmail, IsEnum, IsInt, IsOptional, IsString, Min } from "class-validator";

export class UpdateSchoolProfileDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() logoUrl?: string;
  @IsOptional() @IsEmail() contactEmail?: string;
  @IsOptional() @IsString() contactPhone?: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsInt() @Min(0) attendanceBackdateWindowDays?: number;
  @IsOptional() @IsEnum(AttendanceGranularity) attendanceGranularity?: AttendanceGranularity;
}
