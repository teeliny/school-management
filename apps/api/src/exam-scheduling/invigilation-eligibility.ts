import { BadRequestException } from "@nestjs/common";
import { AssignmentType, Prisma, Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Staff who never invigilate, regardless of the admin-tunable
 * EXCLUDED_INVIGILATION_ASSIGNMENT_TYPES constraint: the Super-Admin
 * (Proprietor — may also hold SUBJECT_TEACHER rows, which would otherwise
 * put them in the pool) and anyone holding an active BURSAR assignment.
 * Mirrors the worker's resolveHardExcludedInvigilatorIds — keep both in sync.
 */
const hardExcludedStaffWhere: Prisma.StaffProfileWhereInput = {
  OR: [
    { user: { roles: { some: { role: Role.SUPER_ADMIN, isActive: true } } } },
    { assignments: { some: { assignmentType: AssignmentType.BURSAR, isActive: true } } },
  ],
};

export async function findHardExcludedInvigilatorIds(
  client: PrismaService | Prisma.TransactionClient,
): Promise<string[]> {
  const rows = await client.staffProfile.findMany({ where: hardExcludedStaffWhere, select: { id: true } });
  return rows.map((r) => r.id);
}

export async function assertInvigilationEligible(
  client: PrismaService | Prisma.TransactionClient,
  staffId: string,
) {
  const excluded = await client.staffProfile.findFirst({ where: { id: staffId, ...hardExcludedStaffWhere } });
  if (excluded) {
    throw new BadRequestException("The Proprietor (Super-Admin) and the Bursar are never assigned invigilation duty");
  }
}
