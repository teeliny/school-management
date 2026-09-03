import { IsOptional, IsString, MinLength } from "class-validator";

export class AcceptInvitationDto {
  // Omitted when the invited email already belongs to an active user
  // (FR1.5, a second-role invite) — that user keeps their existing
  // password; InvitationService.accept() requires it only for a brand-new
  // account.
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}
