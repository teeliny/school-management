import { PartialType } from "@nestjs/mapped-types";
import { DayOfWeek } from "@prisma/client";
import { IsEnum, IsOptional, IsString, IsUUID, Matches } from "class-validator";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateTimetableSlotDto {
  @IsUUID()
  classArmId!: string;

  @IsUUID()
  subjectId!: string;

  @IsUUID()
  staffId!: string;

  @IsUUID()
  academicSessionId!: string;

  @IsUUID()
  termId!: string;

  @IsEnum(DayOfWeek)
  dayOfWeek!: DayOfWeek;

  // "HH:mm" 24-hour — pairs directly with <input type="time">, see
  // prisma/schema.prisma's TimetableSlot comment for why this isn't a Date.
  @Matches(HHMM, { message: "startTime must be in HH:mm format" })
  startTime!: string;

  @Matches(HHMM, { message: "endTime must be in HH:mm format" })
  endTime!: string;

  @IsOptional()
  @IsString()
  venue?: string;
}

export class UpdateTimetableSlotDto extends PartialType(CreateTimetableSlotDto) {}
