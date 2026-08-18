import { IsOptional, IsString } from "class-validator";

export class UpdateAdminProfileDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  employeeId?: string;
}
