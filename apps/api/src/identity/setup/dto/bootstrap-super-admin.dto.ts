import { IsEmail, IsNotEmpty, IsString } from "class-validator";

export class BootstrapSuperAdminDto {
  @IsString()
  @IsNotEmpty()
  schoolName!: string;

  @IsEmail()
  proprietorEmail!: string;

  @IsString()
  @IsNotEmpty()
  proprietorFirstName!: string;

  @IsString()
  @IsNotEmpty()
  proprietorLastName!: string;
}
