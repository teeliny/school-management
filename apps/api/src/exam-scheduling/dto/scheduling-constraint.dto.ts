import { PartialType } from "@nestjs/mapped-types";
import { IsBoolean, IsDefined, IsEnum, IsOptional, IsString } from "class-validator";
import { Prisma, ScheduleScope } from "@prisma/client";

export class CreateSchedulingConstraintDto {
  @IsEnum(ScheduleScope)
  scope!: ScheduleScope;

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
