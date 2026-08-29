import { Gender, GuardianRelationship } from "@prisma/client";
import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from "class-validator";

/**
 * Either `existingParentProfileId` (link an already-known guardian) or
 * `email`+`firstName`+`lastName` (inline-invite a brand-new guardian, PRD
 * FR1.3) must be provided — validated in StudentService, not here, since
 * class-validator can't express "one of these two shapes" cleanly.
 */
export class GuardianInputDto {
  @IsOptional()
  @IsUUID()
  existingParentProfileId?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  // Only meaningful on the brand-new-guardian path (existingParentProfileId
  // not set) — see StudentService.resolveGuardian. Both optional: neither
  // is required to create a guardian, matching User.phone/ParentProfile.
  // address's own nullability.
  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsEnum(GuardianRelationship)
  relationship!: GuardianRelationship;

  @IsOptional()
  @IsBoolean()
  isPrimaryContact?: boolean;

  @IsOptional()
  @IsBoolean()
  isEmergencyContact?: boolean;
}

export class CreateStudentDto {
  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  lastName!: string;

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

  @Type(() => Date)
  @IsDate()
  admissionDate!: Date;

  // Required, not optional: the class arm's academic session + class-level
  // category are what the admission number (YYYY/CC/NNNN) is derived from —
  // see StudentService.create.
  @IsUUID()
  classArmId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GuardianInputDto)
  guardians!: GuardianInputDto[];
}
