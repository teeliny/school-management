import { IsEmail, IsOptional, IsString, MaxLength } from "class-validator";

export class CreateAdmissionInquiryDto {
  @IsString()
  @MaxLength(150)
  parentFullName!: string;

  @IsEmail()
  @MaxLength(254)
  parentEmail!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  parentPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  studentFullName?: string;

  @IsString()
  @MaxLength(100)
  desiredEntryClass!: string;

  @IsString()
  @MaxLength(2000)
  message!: string;

  /**
   * Honeypot — a real visitor never sees or fills this field (hidden via
   * CSS on the marketing form). Any non-empty value here means a bot filled
   * every input it could find, so the controller drops the submission
   * silently rather than persisting it or notifying anyone.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}
