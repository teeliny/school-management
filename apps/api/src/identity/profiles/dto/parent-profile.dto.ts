import { GuardianRelationship } from "@prisma/client";
import { IsEmail, IsEnum, IsOptional, IsString } from "class-validator";

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
}

export class UpdateParentEmailDto {
  @IsEmail()
  email!: string;
}
