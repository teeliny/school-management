import { StaffCategory, StaffStatus } from "@prisma/client";
import { Type } from "class-transformer";
import { IsDate, IsEnum, IsOptional, IsString } from "class-validator";

export class UpdateStaffProfileDto {
  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsOptional()
  @IsEnum(StaffCategory)
  staffCategory?: StaffCategory;

  @IsOptional()
  @IsString()
  department?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  employmentDate?: Date;

  @IsOptional()
  @IsString()
  qualification?: string;

  @IsOptional()
  @IsEnum(StaffStatus)
  status?: StaffStatus;

  // Lives on User, not StaffProfile — see StaffProfileService.update. Also
  // the only field a self-service edit (StaffProfileController.update,
  // caller editing their own profile without a "manage" grant) is allowed
  // to change — every other field above is Admin/Super-Admin HR data.
  @IsOptional()
  @IsString()
  phone?: string;
}
