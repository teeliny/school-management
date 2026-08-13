import { PartialType } from "@nestjs/mapped-types";
import { IsBoolean, IsDefined, IsEnum, IsOptional, IsString } from "class-validator";
import { ClassLevelCategoryGroup, Prisma, ScheduleScope } from "@prisma/client";

export class CreateSchedulingConstraintDto {
  @IsEnum(ScheduleScope)
  scope!: ScheduleScope;

  // Omitted/null = applies to the whole scope; set = a per-group override —
  // see the SchedulingConstraint model comment (prisma/schema.prisma). Was
  // missing from this DTO even though the column is load-bearing (the
  // worker's scheduling-solve-dispatch queries group-scoped rows directly
  // for CLASS_TIMETABLE/EXAM_TIMETABLE/WEEKLY_DUTY) — without it, the
  // ValidationPipe's forbidNonWhitelisted option rejected any attempt to
  // set it via the API, so only the global rows seeded at `setup:school`
  // were ever editable.
  @IsOptional()
  @IsEnum(ClassLevelCategoryGroup)
  classLevelCategoryGroup?: ClassLevelCategoryGroup;

  @IsString()
  key!: string;

  // jsonb — boolean/number/string[] per PRD §3.8's examples, no fixed shape
  // across keys, so validated only for presence (same reasoning as
  // ScheduleGenerationRequest.parameters below).
  @IsDefined()
  value!: Prisma.InputJsonValue;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateSchedulingConstraintDto extends PartialType(CreateSchedulingConstraintDto) {}
