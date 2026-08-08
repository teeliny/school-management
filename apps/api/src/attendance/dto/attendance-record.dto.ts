import { AttendanceStatus } from "@prisma/client";
import { IsEnum, IsOptional, IsString } from "class-validator";

export class UpdateAttendanceRecordDto {
  @IsOptional()
  @IsEnum(AttendanceStatus)
  status?: AttendanceStatus;

  @IsOptional()
  @IsString()
  remark?: string;
}
