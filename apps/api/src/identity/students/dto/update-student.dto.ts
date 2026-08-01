import { StudentStatus } from "@prisma/client";
import { IsEnum, IsOptional, IsString, IsUUID } from "class-validator";

export class UpdateStudentDto {
  @IsOptional()
  @IsUUID()
  classArmId?: string;

  @IsOptional()
  @IsString()
  bloodGroup?: string;

  @IsOptional()
  @IsString()
  medicalNotes?: string;

  @IsOptional()
  @IsEnum(StudentStatus)
  status?: StudentStatus;
}
