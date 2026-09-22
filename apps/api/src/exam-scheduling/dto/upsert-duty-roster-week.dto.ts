import { Type } from "class-transformer";
import { IsBoolean, IsDate, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";
import { ClassLevelCategoryGroup } from "@prisma/client";

// A week that only has DutyAssignment rows (an AI/OR-Tools-generated
// roster, which has no DutyRosterWeek entity of its own — see the schema
// comment) needs one created on demand the first time Admin sets a topic or
// marks a break, identified by its natural key rather than a DutyRosterWeek
// id that doesn't exist yet.
export class UpsertDutyRosterWeekDto {
  @IsUUID()
  termId!: string;

  @IsEnum(ClassLevelCategoryGroup)
  classLevelCategoryGroup!: ClassLevelCategoryGroup;

  @Type(() => Date)
  @IsDate()
  weekStartDate!: Date;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  topic?: string;

  @IsOptional()
  @IsBoolean()
  isBreak?: boolean;
}
