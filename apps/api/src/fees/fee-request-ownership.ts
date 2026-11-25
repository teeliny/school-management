import { ForbiddenException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import type { RequestUser } from "../auth/jwt.strategy";

/**
 * A pending fee request (DiscountRequest / CASH or BANK_TRANSFER_MANUAL
 * Payment) may only be edited by the person who raised it — another Bursar
 * can't quietly rewrite a colleague's submission before the Super-Admin
 * reviews it. The raiser is recorded as a StaffProfile id; null means it was
 * raised by someone with no StaffProfile, which (CASL only lets Bursar/
 * Super-Admin raise) can only be the Super-Admin — a singleton — so a null
 * raiser is theirs. Mirrored client-side by `canEditFeeRequest`
 * (apps/web/src/lib/fee-request-ownership.ts) to decide whether to show Edit.
 */
export async function assertIsFeeRequestRaiser(
  prisma: PrismaService,
  raisedByStaffId: string | null,
  user: RequestUser,
  noun: string,
): Promise<void> {
  if (raisedByStaffId === null) {
    if (user.roles.includes("SUPER_ADMIN")) return;
  } else {
    const staffProfile = await prisma.staffProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (staffProfile?.id === raisedByStaffId) return;
  }
  throw new ForbiddenException(`Only the person who raised this ${noun} can edit it`);
}
