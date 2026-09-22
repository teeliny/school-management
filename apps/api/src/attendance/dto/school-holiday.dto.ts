import { PartialType } from "@nestjs/mapped-types";
import { Type } from "class-transformer";
import { IsBoolean, IsDate, IsOptional, IsString, IsUUID } from "class-validator";

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

// A mid-term break (or any other multi-day closure) as one submission
// instead of one CreateSchoolHolidayDto per day — SchoolHoliday.date stays
// a single-day row per PRD §3.7 (computeSchoolDaysOpened subtracts
// individual dates, not ranges), this just fans a range out into that same
// shape server-side.
export class CreateSchoolHolidayRangeDto {
  @IsString()
  name!: string;

  @Type(() => Date)
  @IsDate()
  startDate!: Date;

  @Type(() => Date)
  @IsDate()
  endDate!: Date;

  @IsOptional()
  @IsUUID()
  academicSessionId?: string;

  @IsOptional()
  @IsUUID()
  termId?: string;

  // Defaults to true — a school week's Sat/Sun were never school days to
  // begin with (computeSchoolDaysOpened already excludes weekends on its
  // own), so a holiday row for them is pure clutter in the holiday list/
  // calendar view rather than something the calculation needs.
  @IsOptional()
  @IsBoolean()
  skipWeekends?: boolean;
}
