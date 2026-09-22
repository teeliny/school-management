import { IsArray, IsEnum, IsInt, IsOptional, IsUUID, Min } from "class-validator";
import { Type } from "class-transformer";
import { ClassLevelCategoryGroup } from "@prisma/client";

export class GenerateDutyRosterDto {
  @IsUUID()
  termId!: string;

  @IsEnum(ClassLevelCategoryGroup)
  classLevelCategoryGroup!: ClassLevelCategoryGroup;

  @IsInt()
  @Min(1)
  teachersPerWeek!: number;

  // Weeks to mark as a break (e.g. mid-term) instead of staffing/generating
  // a topic for — the week's own weekStartDate (YYYY-MM-DD), computed from
  // termId's date range the same way DutyRosterWeekService.resolveWeeks
  // does, so the caller must pass back one of those exact dates.
  @IsOptional()
  @IsArray()
  @Type(() => String)
  breakWeekStartDates?: string[];
}
