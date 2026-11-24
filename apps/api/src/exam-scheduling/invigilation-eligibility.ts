import { BadRequestException } from "@nestjs/common";
import { AssignmentType, Prisma, Role, ScheduleScope } from "@prisma/client";
import { EXCLUDED_INVIGILATION_STAFF_IDS_KEY } from "@school/types";
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

/**
 * Individually excluded staff (EXCLUDED_INVIGILATION_STAFF_IDS, a global
 * INVIGILATION constraint — e.g. part-time teachers). Mirrors the worker's
 * resolveHardExcludedInvigilatorIds.
 */
async function findIndividuallyExcludedStaffIds(client: PrismaService | Prisma.TransactionClient): Promise<string[]> {
  const row = await client.schedulingConstraint.findFirst({
    where: { scope: ScheduleScope.INVIGILATION, classLevelCategoryGroup: null, key: EXCLUDED_INVIGILATION_STAFF_IDS_KEY, isActive: true },
  });
  return Array.isArray(row?.value) ? row.value.filter((v): v is string => typeof v === "string") : [];
}

export async function findHardExcludedInvigilatorIds(
  client: PrismaService | Prisma.TransactionClient,
): Promise<string[]> {
  const rows = await client.staffProfile.findMany({ where: hardExcludedStaffWhere, select: { id: true } });
  return [...new Set([...rows.map((r) => r.id), ...(await findIndividuallyExcludedStaffIds(client))])];
}

export async function assertInvigilationEligible(
  client: PrismaService | Prisma.TransactionClient,
  staffId: string,
) {
  const excluded = await client.staffProfile.findFirst({ where: { id: staffId, ...hardExcludedStaffWhere } });
  if (excluded) {
    throw new BadRequestException("The Proprietor (Super-Admin) and the Bursar are never assigned invigilation duty");
  }
  if ((await findIndividuallyExcludedStaffIds(client)).includes(staffId)) {
    throw new BadRequestException("This staff member is excluded from invigilation duty");
  }
}
