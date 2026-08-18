import { PartialType } from "@nestjs/mapped-types";
import { IsUUID } from "class-validator";

export class CreateStudentDepartmentDto {
  @IsUUID()
  studentId!: string;

  @IsUUID()
  departmentId!: string;

  @IsUUID()
  academicSessionId!: string;
}

export class UpdateStudentDepartmentDto extends PartialType(CreateStudentDepartmentDto) {}
