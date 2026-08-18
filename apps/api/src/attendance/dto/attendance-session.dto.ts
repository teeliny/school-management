import { AttendancePersonType, AttendanceSessionKind, AttendanceSessionType, AttendanceStatus } from "@prisma/client";
import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsDate, IsEnum, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";

export class AttendanceRecordInputDto {
  @IsUUID()
  personId!: string;

  @IsEnum(AttendanceStatus)
  status!: AttendanceStatus;

  @IsOptional()
  @IsString()
  remark?: string;
}

// personType isn't accepted from the client — it's derived server-side from
// dto.type (STUDENT/STAFF session ⇒ every record in it is that same
// personType), same "server decides, never trusts the client for a value it
// can already derive" reasoning as ScoreEntry's enteredByStaffId.
export type AttendanceRecordInput = AttendanceRecordInputDto & { personType: AttendancePersonType };

export class CreateAttendanceSessionDto {
  @IsEnum(AttendanceSessionType)
  type!: AttendanceSessionType;

  @IsEnum(AttendanceSessionKind)
  kind!: AttendanceSessionKind;

  // Required for STUDENT-type sessions, must be absent for STAFF (school-
  // wide) — checked in the service, not here, since it's conditional on
  // another field.
  @IsOptional()
  @IsUUID()
  classArmId?: string;

  @Type(() => Date)
  @IsDate()
  date!: Date;

  // "MORNING"/"AFTERNOON" for a DAILY session under MORNING_AND_AFTERNOON
  // granularity, or a free-text period label for a PERIOD session.
  @IsOptional()
  @IsString()
  period?: string;

  // Required for kind=PERIOD.
  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AttendanceRecordInputDto)
  records!: AttendanceRecordInputDto[];
}
