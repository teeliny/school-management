import { AttendanceStatus, ClassLevelCategoryGroup, Gender, InvoiceStatus, PaymentMethod, ScheduleScope } from "@prisma/client";
import { categoryToGroup, computeAttendancePercentage, computeOutstandingBalance, type ClassLevelCategory } from "@school/types";
import type { BroadsheetRow } from "../assessments/broadsheet";

/**
 * Pure, Prisma-free shaping/aggregation logic for DashboardService — same
 * split as calendar.util.ts/calendar.ts: the service does the fetching,
 * these functions turn already-fetched rows into the response shapes.
 * Nothing here talks to the database or throws for authorization; that
 * stays in dashboard.service.ts.
 */

// Mirrors payment-reconciliation.processor.ts's GATEWAY_METHODS/
// STUCK_THRESHOLD_MS exactly — apps/api can't call into the worker process,
// same cross-process boundary BroadsheetService's reimplementation of
// computeAnnualSummary already established, so the "stuck payment" query
// shape is duplicated here rather than shared.
export const GATEWAY_METHODS: PaymentMethod[] = [
  PaymentMethod.GATEWAY_CARD,
  PaymentMethod.GATEWAY_TRANSFER,
  PaymentMethod.GATEWAY_USSD,
  PaymentMethod.GATEWAY_RESERVED_ACCOUNT,
];
export const STUCK_THRESHOLD_MS = 15 * 60 * 1000;

// Sunday-anchored week bucket, UTC — consistent bucketing is all that
// matters here (a "week" isn't a business concept enforced elsewhere in the
// schema), not alignment with any particular school calendar convention.
export function startOfWeek(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d;
}

// ---------------------------------------------------------------------------
// Finance (financeOverview)
// ---------------------------------------------------------------------------

interface InvoiceForBalance {
  totalAmount: unknown;
  lineItems: { amount: unknown; type: string }[];
  payments: { amount: unknown; status: string }[];
}

/** Same formula as InvoiceService.attachOutstandingBalance — outstanding balance is never stored, always computed fresh. */
export function computeInvoiceOutstanding(invoice: InvoiceForBalance): number {
  const discountAmounts = invoice.lineItems.filter((li) => li.type === "DISCOUNT").map((li) => Number(li.amount));
  const successfulPaymentAmounts = invoice.payments.filter((p) => p.status === "SUCCESSFUL").map((p) => Number(p.amount));
  return computeOutstandingBalance(Number(invoice.totalAmount), discountAmounts, successfulPaymentAmounts);
}

export function sumOutstandingBalances(invoices: InvoiceForBalance[]): number {
  return invoices.reduce((sum, invoice) => sum + computeInvoiceOutstanding(invoice), 0);
}

interface InvoiceWithClassArm extends InvoiceForBalance {
  student: { currentClass: { id: string; name: string; classLevel: { name: string } } | null };
}

export function groupOutstandingByClass(
  invoices: InvoiceWithClassArm[],
): { classArmId: string; className: string; outstanding: number }[] {
  const byClass = new Map<string, { classArmId: string; className: string; outstanding: number }>();
  for (const invoice of invoices) {
    const arm = invoice.student.currentClass;
    if (!arm) continue;
    const outstanding = computeInvoiceOutstanding(invoice);
    const existing = byClass.get(arm.id);
    if (existing) existing.outstanding += outstanding;
    else byClass.set(arm.id, { classArmId: arm.id, className: `${arm.classLevel.name} ${arm.name}`, outstanding });
  }
  return [...byClass.values()].sort((a, b) => b.outstanding - a.outstanding);
}

export function tallyInvoicesByStatus(statusGroups: { status: InvoiceStatus; _count: number }[]): Record<InvoiceStatus, number> {
  return Object.fromEntries(
    (["UNPAID", "PARTIAL", "PAID", "OVERDUE"] satisfies InvoiceStatus[]).map((status) => [
      status,
      statusGroups.find((g) => g.status === status)?._count ?? 0,
    ]),
  ) as Record<InvoiceStatus, number>;
}

// ---------------------------------------------------------------------------
// School composition
// ---------------------------------------------------------------------------

interface ClassArmForComposition {
  id: string;
  classLevelId: string;
  name: string;
  classLevel: { name: string };
  students: { id: string }[];
  staffAssignments: { id: string }[];
}
interface StudentDepartmentRow {
  departmentId: string;
  department: { name: string };
}

export function groupStudentsByLevel(classArms: ClassArmForComposition[]): { classLevelId: string; name: string; count: number }[] {
  const studentsByLevel = new Map<string, { classLevelId: string; name: string; count: number }>();
  for (const arm of classArms) {
    const existing = studentsByLevel.get(arm.classLevelId);
    const count = arm.students.length;
    if (existing) existing.count += count;
    else studentsByLevel.set(arm.classLevelId, { classLevelId: arm.classLevelId, name: arm.classLevel.name, count });
  }
  return [...studentsByLevel.values()];
}

export function groupStudentsByDepartment(
  studentDepartments: StudentDepartmentRow[],
): { departmentId: string; name: string; count: number }[] {
  const studentsByDepartment = new Map<string, { departmentId: string; name: string; count: number }>();
  for (const row of studentDepartments) {
    const existing = studentsByDepartment.get(row.departmentId);
    if (existing) existing.count += 1;
    else studentsByDepartment.set(row.departmentId, { departmentId: row.departmentId, name: row.department.name, count: 1 });
  }
  return [...studentsByDepartment.values()];
}

/** No DB constraint stops a class arm from having zero active CLASS_TEACHER assignments (StaffAssignmentService.create's own comment) — this just surfaces which ones do. */
export function findUnfilledClassTeacherGaps(
  classArms: ClassArmForComposition[],
): { classArmId: string; className: string; missing: readonly ["CLASS_TEACHER"] }[] {
  return classArms
    .filter((arm) => arm.staffAssignments.length === 0)
    .map((arm) => ({ classArmId: arm.id, className: `${arm.classLevel.name} ${arm.name}`, missing: ["CLASS_TEACHER"] as const }));
}

// ---------------------------------------------------------------------------
// Invitation trend
// ---------------------------------------------------------------------------

interface InvitationForTrend {
  invitedRole: string;
  createdAt: Date;
  acceptedAt: Date | null;
}

export function bucketInvitationsByWeek(
  invitations: InvitationForTrend[],
): { weekStart: string; role: string; sent: number; accepted: number }[] {
  const buckets = new Map<string, { weekStart: string; role: string; sent: number; accepted: number }>();
  for (const invitation of invitations) {
    const weekStart = startOfWeek(invitation.createdAt).toISOString().slice(0, 10);
    const key = `${weekStart}:${invitation.invitedRole}`;
    const bucket = buckets.get(key) ?? { weekStart, role: invitation.invitedRole, sent: 0, accepted: 0 };
    bucket.sent += 1;
    if (invitation.acceptedAt) bucket.accepted += 1;
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

// ---------------------------------------------------------------------------
// Schedule approvals
// ---------------------------------------------------------------------------

interface ScheduleRequestForScope {
  scope: ScheduleScope;
  classLevelCategoryGroup: ClassLevelCategoryGroup | null;
  classArm: { classLevel: { category: ClassLevelCategory } } | null;
  assessmentComponent: { classLevelCategory: ClassLevelCategory } | null;
}

/** Reuses ScheduleGenerationRequestService's own resolveTargetGroup branching (§5 footnote 5) as a read filter instead of a create-time gate. */
export function countScheduleApprovalsByScope(
  requests: ScheduleRequestForScope[],
  scopeGroup: ClassLevelCategoryGroup | null,
): { scope: ScheduleScope; pendingCount: number }[] {
  const inScope = scopeGroup
    ? requests.filter((r) => {
        const category = r.classArm?.classLevel.category ?? r.assessmentComponent?.classLevelCategory ?? null;
        const group = r.classLevelCategoryGroup ?? (category ? categoryToGroup(category) : null);
        return group === scopeGroup;
      })
    : requests;

  const counts = new Map<ScheduleScope, number>();
  for (const request of inScope) {
    counts.set(request.scope, (counts.get(request.scope) ?? 0) + 1);
  }

  return (["CLASS_TIMETABLE", "EXAM_TIMETABLE", "INVIGILATION", "WEEKLY_DUTY"] satisfies ScheduleScope[]).map((scope) => ({
    scope,
    pendingCount: counts.get(scope) ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// Score entry completion
// ---------------------------------------------------------------------------

interface ClassSubjectForFlatten {
  subject: { id: string; name: string; isGroup: boolean; childSubjects: { id: string; name: string }[] };
}

/** A group subject is never itself scoreable — same flatten-to-childSubjects rule every other subject picker in this codebase applies (see CLAUDE.md's selectableSubjects note). */
export function flattenScoreableSubjects(classSubjects: ClassSubjectForFlatten[]): { id: string; name: string }[] {
  return classSubjects.flatMap((cs) => (cs.subject.isGroup ? cs.subject.childSubjects : [{ id: cs.subject.id, name: cs.subject.name }]));
}

interface ClassArmForScoreEntry {
  id: string;
  name: string;
  classLevel: { name: string };
  students: { id: string }[];
}
export interface ScoreEntryCompletionRow {
  classArmId: string;
  className: string;
  subjectId: string;
  subjectName: string;
  componentId: string;
  componentName: string;
  totalStudents: number;
  enteredCount: number;
}

/** One groupBy against ScoreEntry, cross-joined here rather than a loop of ScoreEntryService.summary per cell (BUILD_PLAN.md §8 item 5's N+1 precedent). */
export function buildScoreEntryCompletionRows(
  classArms: ClassArmForScoreEntry[],
  subjects: { id: string; name: string }[],
  components: { id: string; name: string }[],
  countByKey: Map<string, number>,
): ScoreEntryCompletionRow[] {
  const rows: ScoreEntryCompletionRow[] = [];
  for (const arm of classArms) {
    for (const subject of subjects) {
      for (const component of components) {
        rows.push({
          classArmId: arm.id,
          className: `${arm.classLevel.name} ${arm.name}`,
          subjectId: subject.id,
          subjectName: subject.name,
          componentId: component.id,
          componentName: component.name,
          totalStudents: arm.students.length,
          enteredCount: countByKey.get(`${arm.id}:${subject.id}:${component.id}`) ?? 0,
        });
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Attendance aggregation — shared by attendanceOverview and
// classAttendanceDailyTrend. Deliberately a different methodology from
// AttendanceAnalyticsService's "% of school days opened" figure (that
// denominator answers "how present has this class been all term"; this
// answers "did today's attendance get taken, and how does it compare to the
// rolling average" — a records-taken-vs-present ratio, not a calendar-aware
// one).
// ---------------------------------------------------------------------------

export interface AttendanceBucket {
  present: number;
  total: number;
}

export function bucketPercentage(bucket: AttendanceBucket | undefined): number | null {
  return bucket && bucket.total > 0 ? Math.round((bucket.present / bucket.total) * 1000) / 10 : null;
}

interface AttendanceRecordForAggregation {
  status: AttendanceStatus;
  attendanceSession: { date: Date; classArmId: string | null };
}
interface ClassArmForAttendance {
  id: string;
  name: string;
  classLevel: { name: string };
}

export function aggregateSchoolAttendance(records: AttendanceRecordForAggregation[], classArms: ClassArmForAttendance[], todayKey: string) {
  const byClassByDay = new Map<string, Map<string, AttendanceBucket>>();
  const byDaySchool = new Map<string, AttendanceBucket>();

  for (const record of records) {
    const dateKey = record.attendanceSession.date.toISOString().slice(0, 10);
    const classArmId = record.attendanceSession.classArmId;
    if (!classArmId) continue;
    const isPresent = record.status === AttendanceStatus.PRESENT;

    const classDay = byClassByDay.get(classArmId) ?? new Map<string, AttendanceBucket>();
    const classBucket = classDay.get(dateKey) ?? { present: 0, total: 0 };
    classBucket.total += 1;
    if (isPresent) classBucket.present += 1;
    classDay.set(dateKey, classBucket);
    byClassByDay.set(classArmId, classDay);

    const schoolBucket = byDaySchool.get(dateKey) ?? { present: 0, total: 0 };
    schoolBucket.total += 1;
    if (isPresent) schoolBucket.present += 1;
    byDaySchool.set(dateKey, schoolBucket);
  }

  const byClass = classArms.map((arm) => {
    const days = byClassByDay.get(arm.id);
    const percentageToday = bucketPercentage(days?.get(todayKey));

    let termPresent = 0;
    let termTotal = 0;
    if (days) {
      for (const bucket of days.values()) {
        termPresent += bucket.present;
        termTotal += bucket.total;
      }
    }
    const termAveragePercentage = bucketPercentage({ present: termPresent, total: termTotal });
    const deltaFromTermAverage =
      percentageToday !== null && termAveragePercentage !== null ? Math.round((percentageToday - termAveragePercentage) * 10) / 10 : null;

    return {
      classArmId: arm.id,
      className: `${arm.classLevel.name} ${arm.name}`,
      percentageToday,
      termAveragePercentage,
      deltaFromTermAverage,
    };
  });

  const anomalies = [...byClass]
    .filter((c) => c.percentageToday !== null)
    .sort((a, b) => a.percentageToday! - b.percentageToday!)
    .slice(0, 10);

  const schoolDailyTrend = [...byDaySchool.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, bucket]) => ({ date, percentage: bucketPercentage(bucket) }));

  return { anomalies, byClass, schoolDailyTrend };
}

export function aggregateClassDailyTrend(records: { status: AttendanceStatus; attendanceSession: { date: Date } }[]): { date: string; percentage: number | null }[] {
  const byDay = new Map<string, AttendanceBucket>();
  for (const record of records) {
    const dateKey = record.attendanceSession.date.toISOString().slice(0, 10);
    const bucket = byDay.get(dateKey) ?? { present: 0, total: 0 };
    bucket.total += 1;
    if (record.status === AttendanceStatus.PRESENT) bucket.present += 1;
    byDay.set(dateKey, bucket);
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, bucket]) => ({ date, percentage: bucketPercentage(bucket) }));
}

// ---------------------------------------------------------------------------
// Class roster gender split
// ---------------------------------------------------------------------------

export function computeGenderSplit(students: { user: { gender: Gender | null } }[]) {
  const genderSplit = { male: 0, female: 0, other: 0, unspecified: 0 };
  for (const student of students) {
    if (student.user.gender === "MALE") genderSplit.male += 1;
    else if (student.user.gender === "FEMALE") genderSplit.female += 1;
    else if (student.user.gender === "OTHER") genderSplit.other += 1;
    else genderSplit.unspecified += 1;
  }
  return genderSplit;
}

// ---------------------------------------------------------------------------
// Broadsheet snapshot ranking
// ---------------------------------------------------------------------------

/** `computedAt` is always "now" — see DashboardService.broadsheetSnapshot's comment on why this is live-computed, not read from a cache. */
export function rankBroadsheetSnapshot(rows: BroadsheetRow[]) {
  const ranked = rows.filter((row) => row.overallAverage !== null).sort((a, b) => b.overallAverage! - a.overallAverage!);
  return {
    computedAt: new Date().toISOString(),
    topStudents: ranked.slice(0, 5),
    bottomStudents: ranked.slice(-5).reverse(),
  };
}

// ---------------------------------------------------------------------------
// Parent/Student attendance summary
// ---------------------------------------------------------------------------

export function summarizeStudentAttendance(records: { status: AttendanceStatus; attendanceSession: { date: Date } }[], schoolDaysOpened: number) {
  const counts = { present: 0, absent: 0, late: 0, excused: 0 };
  for (const record of records) {
    if (record.status === AttendanceStatus.PRESENT) counts.present += 1;
    else if (record.status === AttendanceStatus.ABSENT) counts.absent += 1;
    else if (record.status === AttendanceStatus.LATE) counts.late += 1;
    else counts.excused += 1;
  }

  const recentAbsences = records
    .filter((r) => r.status === AttendanceStatus.ABSENT)
    .slice(0, 5)
    .map((r) => ({ date: r.attendanceSession.date }));

  return {
    schoolDaysOpened,
    ...counts,
    percentage: computeAttendancePercentage(counts.present, schoolDaysOpened),
    recentAbsences,
  };
}
