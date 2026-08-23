import { CareerContactInquiryType } from "@prisma/client";
import { IsEmail, IsEnum, IsOptional, IsString, MaxLength } from "class-validator";

export class CreateCareerContactInquiryDto {
  @IsEnum(CareerContactInquiryType)
  type!: CareerContactInquiryType;

  @IsString()
  @MaxLength(150)
  fullName!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  subject?: string;

  @IsString()
  @MaxLength(2000)
  message!: string;

  // Honeypot — see CreateAdmissionInquiryDto.website.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}
