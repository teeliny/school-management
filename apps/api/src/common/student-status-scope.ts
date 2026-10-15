import { Prisma, StudentStatus } from "@prisma/client";

// Which non-ACTIVE (graduated/withdrawn/suspended) students still belong on
// a historical view, keyed off StudentProfile.inactiveSince. Mirrored in
// apps/worker/src/common/student-status-scope.ts — keep both in sync.
//
// Each returns a single `OR` clause, so spread it only into a where object
// with no `OR` of its own (otherwise wrap both in an `AND` array).

/**
 * A term's roster: still ACTIVE, or left on/after the term's endDate (i.e.
 * completed it). A student who left during (or before) the term is not on
 * it. For a span of terms (a session broadsheet), pass the *earliest*
 * term's endDate — they count if they completed at least one term in it.
 */
export function studentInTermWhere(termEndDate: Date): Prisma.StudentProfileWhereInput {
  return { OR: [{ status: StudentStatus.ACTIVE }, { inactiveSince: { gte: termEndDate } }] };
}

/** A single day's roster (attendance register): still ACTIVE, or left after that day. */
export function studentActiveOnDateWhere(date: Date): Prisma.StudentProfileWhereInput {
  return { OR: [{ status: StudentStatus.ACTIVE }, { inactiveSince: { gt: date } }] };
}
