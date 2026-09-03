import { Role, StaffCategory } from "@prisma/client";
import { IsEmail, IsEnum, IsIn, IsNotEmpty, IsOptional, IsString } from "class-validator";

/**
 * SUPER_ADMIN is deliberately not accepted here — it's only ever created by
 * the one-time `pnpm setup:school` script or its unauthenticated
 * `POST /setup/super-admin` HTTP alternative (both backed by
 * `SetupService`, PRD §3.1a, ARCHITECTURE.md §6.1), never via this
 * ordinary authenticated invitations DTO. STUDENT is never invited at all
 * (PRD FR1.3).
 */
const INVITABLE_ROLES = [Role.ADMIN, Role.STAFF, Role.PARENT] as const;

export class CreateInvitationDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  lastName!: string;

  @IsIn(INVITABLE_ROLES)
  invitedRole!: Role;

  @IsOptional()
  @IsEnum(StaffCategory)
  staffCategory?: StaffCategory;

  @IsOptional()
  @IsString()
  phone?: string;
}
