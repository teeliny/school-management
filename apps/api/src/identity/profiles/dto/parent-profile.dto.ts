import { GuardianRelationship } from "@prisma/client";
import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString } from "class-validator";

export class UpdateParentProfileDto {
  @IsOptional()
  @IsString()
  occupation?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsEnum(GuardianRelationship)
  relationshipToStudentDefault?: GuardianRelationship;

  // Lives on User, not ParentProfile — see ParentProfileService.update.
  @IsOptional()
  @IsString()
  phone?: string;

  // Also on User. Admin/Super-Admin only — ParentProfileController.update
  // strips these from a self-service edit.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  firstName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  lastName?: string;

  @IsOptional()
  @IsString()
  middleName?: string;
}

export class UpdateParentEmailDto {
  @IsEmail()
  email!: string;
}
