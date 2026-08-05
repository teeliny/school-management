import { PartialType } from "@nestjs/mapped-types";
import { ClassLevelCategory, SubjectType } from "@prisma/client";
import { IsEnum, IsOptional, IsUUID } from "class-validator";

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
}

export class UpdateClassSubjectDto extends PartialType(CreateClassSubjectDto) {}
