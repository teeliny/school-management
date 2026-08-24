import { Gender, StudentStatus } from "@prisma/client";
import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsDate, IsEnum, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";
import { GuardianInputDto } from "./create-student.dto";

export class UpdateStudentDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  middleName?: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dateOfBirth?: Date;

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

  // Full desired guardian list — reconciled against the current set in
  // StudentService.update (find-diff, same shape as StaffAssignment's
  // syncSubjectTeacherAssignments): rows with a matching existingParentProfileId
  // are kept/updated, unmatched current guardians are removed, unmatched
  // incoming rows are added via resolveGuardian (same as create).
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GuardianInputDto)
  guardians?: GuardianInputDto[];
}
