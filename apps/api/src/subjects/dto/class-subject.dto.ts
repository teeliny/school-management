import { PartialType } from "@nestjs/mapped-types";
import { ClassLevelCategory, SubjectType } from "@prisma/client";
import { IsEnum, IsInt, IsOptional, IsUUID, Min } from "class-validator";

export class CreateClassSubjectDto {
  @IsEnum(ClassLevelCategory)
  classLevelCategory!: ClassLevelCategory;

  @IsUUID()
  subjectId!: string;

  @IsEnum(SubjectType)
  type!: SubjectType;

  // Required when type=DEPARTMENT, rejected otherwise (PRD §3.3) — validated
  // in ClassSubjectService, not here, since it depends on another field's value.
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  // BUILD_PLAN.md §9 Step 2: the class-timetable solver's per-subject
  // frequency target. Optional here (defaults to 3 at the DB layer) so
  // existing callers that don't yet care about scheduling aren't forced to
  // supply it.
  @IsOptional()
  @IsInt()
  @Min(1)
  periodsPerWeek?: number;
}

export class UpdateClassSubjectDto extends PartialType(CreateClassSubjectDto) {}
