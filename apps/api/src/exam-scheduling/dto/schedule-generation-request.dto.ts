import { IsDefined, IsEnum, IsOptional, IsUUID } from "class-validator";
import { ClassLevelCategoryGroup, Prisma, ScheduleScope } from "@prisma/client";

export class CreateScheduleGenerationRequestDto {
  @IsEnum(ScheduleScope)
  scope!: ScheduleScope;

  // null/omitted = whole triggering-user scope (FR6.2); set only for a
  // single-arm regeneration (FR6.5).
  @IsOptional()
  @IsUUID()
  classArmId?: string;

  @IsOptional()
  @IsUUID()
  assessmentComponentId?: string;

  @IsOptional()
  @IsUUID()
  termId?: string;

  @IsOptional()
  @IsEnum(ClassLevelCategoryGroup)
  classLevelCategoryGroup?: ClassLevelCategoryGroup;

  // Run-specific overrides layered on the stored SchedulingConstraint
  // defaults (e.g. MID_TERM's maxSubjectsPerDay, FR6.3a) — no fixed shape
  // across scopes, validated only for presence when supplied.
  @IsOptional()
  @IsDefined()
  parameters?: Prisma.InputJsonValue;
}
