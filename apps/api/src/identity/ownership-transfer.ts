import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Injectable,
  Post,
  UseGuards,
} from "@nestjs/common";
import { IsUUID } from "class-validator";
import { Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { UserService } from "./users/user.service";
import { Audited } from "../audit/audited.decorator";

export class TransferOwnershipDto {
  @IsUUID()
  targetUserId!: string;
}

@Injectable()
export class OwnershipTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
  ) {}

  /**
   * PRD FR1.9: atomic Super-Admin -> another user handoff. The caller's
   * active SUPER_ADMIN row is deactivated before the target's is
   * created/reactivated, in the same transaction, so the partial unique
   * index on active SUPER_ADMIN rows (see the identity_and_academic_structure
   * migration) is satisfied at every statement, not just at commit — no
   * deferred trigger needed here, unlike StudentGuardian.
   */
  async transfer(currentSuperAdminId: string, targetUserId: string) {
    if (currentSuperAdminId === targetUserId) {
      throw new BadRequestException("Cannot transfer ownership to yourself");
    }

    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new BadRequestException("Target user not found");

    return this.prisma.$transaction(async (tx) => {
      await tx.userRole.updateMany({
        where: { userId: currentSuperAdminId, role: Role.SUPER_ADMIN, isActive: true },
        data: { isActive: false },
      });
      await this.userService.grantRole(currentSuperAdminId, Role.ADMIN, tx);
      await this.userService.grantRole(targetUserId, Role.SUPER_ADMIN, tx);
      return tx.user.findUniqueOrThrow({ where: { id: targetUserId }, include: { roles: true } });
    });
  }
}

@Controller("ownership")
@UseGuards(JwtAuthGuard)
export class OwnershipTransferController {
  constructor(private readonly service: OwnershipTransferService) {}

  // PRD FR1.9 names this action explicitly as audit-worthy. No model — this
  // is inherently a two-user, multi-row UserRole change (the caller's
  // demotion + the target's promotion) that a single before/after pair
  // can't represent cleanly; the response (target user + roles) is still
  // logged as `after`.
  @Post("transfer")
  @Audited("UserRole")
  transfer(@Body() dto: TransferOwnershipDto, @CurrentUser() user: RequestUser) {
    // Owner-only action (PRD §5 footnote 1) — plain role check, same as the
    // existing owner-only carve-outs in AbilityFactory/invitations.
    if (!user.roles.includes("SUPER_ADMIN")) {
      throw new ForbiddenException("Only the Super-Admin can transfer ownership");
    }
    return this.service.transfer(user.id, dto.targetUserId);
  }
}
