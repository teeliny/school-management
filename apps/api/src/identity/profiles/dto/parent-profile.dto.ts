import { GuardianRelationship } from "@prisma/client";
import { IsEnum, IsOptional, IsString } from "class-validator";

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
}
