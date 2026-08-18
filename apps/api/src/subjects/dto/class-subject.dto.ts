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

  // "Options column" membership (schema.prisma's ClassSubjectConcurrencyGroup)
  // — validated in ClassSubjectService.assertConcurrencyGroupConsistency, not
  // here, since it depends on the group's own classLevelCategory/existing
  // members' periodsPerWeek. Nullable (not just optional) so an update can
  // send `null` explicitly to remove a row from its elective block —
  // departmentId instead clears itself automatically off a type change, but
  // there's no analogous field driving concurrencyGroupId.
  @IsOptional()
  @IsUUID()
  concurrencyGroupId?: string | null;
}

export class UpdateClassSubjectDto extends PartialType(CreateClassSubjectDto) {}
