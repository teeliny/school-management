import { AttendanceStatus } from "@prisma/client";
import { IsEnum, IsOptional, IsString, IsUUID } from "class-validator";
import { AttendanceRecordInputDto } from "./attendance-session.dto";

export class UpdateAttendanceRecordDto {
  @IsOptional()
  @IsEnum(AttendanceStatus)
  status?: AttendanceStatus;

  @IsOptional()
  @IsString()
  remark?: string;
}

// For a roster person whose record is missing from an already-taken session
// (e.g. never created, or lost) — same personId/status/remark shape as
// AttendanceRecordInputDto plus the target session. Gated by the same
// write-access/backdate-window checks as AttendanceRecordService.update, so
// it's no more permissive to add a record than to edit one.
export class CreateAttendanceRecordDto extends AttendanceRecordInputDto {
  @IsUUID()
  attendanceSessionId!: string;
}
