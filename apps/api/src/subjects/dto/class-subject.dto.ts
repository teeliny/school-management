import { PartialType } from "@nestjs/mapped-types";
import { IsBoolean, IsOptional, IsUUID } from "class-validator";

export class CreateClassSubjectDto {
  @IsUUID()
  classLevelId!: string;

  @IsUUID()
  subjectId!: string;

  @IsUUID()
  academicSessionId!: string;

  @IsOptional()
  @IsBoolean()
  isCompulsoryOverride?: boolean;
}

export class UpdateClassSubjectDto extends PartialType(CreateClassSubjectDto) {}
