import { Controller, ForbiddenException, Get, Injectable, Query, UseGuards } from "@nestjs/common";
import { AssignmentType, ClassLevelCategoryGroup, InvoiceStatus, PaymentMethod, ScheduleScope, StaffStatus, StudentStatus } from "@prisma/client";
import { categoryToGroup, computeOutstandingBalance } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { StaffAssignmentService } from "../staff-assignments/staff-assignment";

// Mirrors payment-reconciliation.processor.ts's GATEWAY_METHODS/
// STUCK_THRESHOLD_MS exactly — apps/api can't call into the worker process,
// same cross-process boundary BroadsheetService's reimplementation of
// computeAnnualSummary already established, so the "stuck payment" query
// shape is duplicated here rather than shared.
const GATEWAY_METHODS: PaymentMethod[] = [
  PaymentMethod.GATEWAY_CARD,
  PaymentMethod.GATEWAY_TRANSFER,
  PaymentMethod.GATEWAY_USSD,
  PaymentMethod.GATEWAY_RESERVED_ACCOUNT,
];
const STUCK_THRESHOLD_MS = 15 * 60 * 1000;

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly staffAssignments: StaffAssignmentService,
  ) {}

  private async assertCanViewFinance(user: RequestUser) {
    if (user.roles.includes("SUPER_ADMIN")) return;
    const assignment = await this.staffAssignments.findActiveAssignment({ userId: user.id, assignmentType: AssignmentType.BURSAR });
    if (!assignment) {
      throw new ForbiddenException("Only Super-Admin or an active Bursar can view finance data");
    }
  }

  private assertSuperAdmin(user: RequestUser) {
    if (!user.roles.includes("SUPER_ADMIN")) {
      throw new ForbiddenException("Super-Admin only");
    }
  }

  private assertAdminOrSuperAdmin(user: RequestUser) {
    if (!user.roles.includes("SUPER_ADMIN") && !user.roles.includes("ADMIN")) {
      throw new ForbiddenException("Admin or Super-Admin only");
    }
  }

  /**
   * PRD FR9.4/FR9.7: outstanding balance is never stored (packages/types'
   * own comment on computeOutstandingBalance), so both the school-wide sum
   * and the by-class breakdown are computed fresh from each invoice's line
   * items/payments, same formula InvoiceService.attachOutstandingBalance
   * applies per-row. "Trend vs last term" compares against whichever term
   * chronologically precedes the requested one (by startDate, regardless of
   * session) — null when there isn't one yet.
   */
  async financeOverview(user: RequestUser, termId: string) {
    await this.assertCanViewFinance(user);

    const term = await this.prisma.term.findUniqueOrThrow({ where: { id: termId } });
    const outstandingSchoolWide = await this.sumOutstandingForTerm(termId);

    const previousTerm = await this.prisma.term.findFirst({
      where: { startDate: { lt: term.startDate } },
      orderBy: { startDate: "desc" },
    });
    const outstandingTrendVsLastTerm = previousTerm
      ? outstandingSchoolWide - (await this.sumOutstandingForTerm(previousTerm.id))
      : null;

    const invoices = await this.prisma.invoice.findMany({
      where: { termId },
      include: {
        lineItems: true,
        payments: true,
        student: { select: { currentClass: { select: { id: true, name: true, classLevel: { select: { name: true } } } } } },
      },
    });
    const byClass = new Map<string, { classArmId: string; className: string; outstanding: number }>();
    for (const invoice of invoices) {
      const arm = invoice.student.currentClass;
      if (!arm) continue;
      const discountAmounts = invoice.lineItems.filter((li) => li.type === "DISCOUNT").map((li) => Number(li.amount));
      const successfulPaymentAmounts = invoice.payments.filter((p) => p.status === "SUCCESSFUL").map((p) => Number(p.amount));
      const outstanding = computeOutstandingBalance(Number(invoice.totalAmount), discountAmounts, successfulPaymentAmounts);
      const existing = byClass.get(arm.id);
      if (existing) existing.outstanding += outstanding;
      else byClass.set(arm.id, { classArmId: arm.id, className: `${arm.classLevel.name} ${arm.name}`, outstanding });
    }

    const statusGroups = await this.prisma.invoice.groupBy({ by: ["status"], where: { termId }, _count: true });
    const invoicesByStatus = Object.fromEntries(
      (["UNPAID", "PARTIAL", "PAID", "OVERDUE"] satisfies InvoiceStatus[]).map((status) => [
        status,
        statusGroups.find((g) => g.status === status)?._count ?? 0,
      ]),
    ) as Record<InvoiceStatus, number>;

    const reconciliationStuckCount = await this.prisma.payment.count({
      where: {
        status: "PENDING",
        method: { in: GATEWAY_METHODS },
        gatewayProvider: { not: null },
        createdAt: { lt: new Date(Date.now() - STUCK_THRESHOLD_MS) },
      },
    });

    return {
      termId,
      termName: term.name,
      outstandingSchoolWide,
      outstandingTrendVsLastTerm,
      outstandingByClass: [...byClass.values()].sort((a, b) => b.outstanding - a.outstanding),
      invoicesByStatus,
      reconciliationStuckCount,
    };
  }

  private async sumOutstandingForTerm(termId: string): Promise<number> {
    const invoices = await this.prisma.invoice.findMany({
      where: { termId },
      select: { totalAmount: true, lineItems: { select: { amount: true, type: true } }, payments: { select: { amount: true, status: true } } },
    });
    return invoices.reduce((sum, invoice) => {
      const discountAmounts = invoice.lineItems.filter((li) => li.type === "DISCOUNT").map((li) => Number(li.amount));
      const successfulPaymentAmounts = invoice.payments.filter((p) => p.status === "SUCCESSFUL").map((p) => Number(p.amount));
      return sum + computeOutstandingBalance(Number(invoice.totalAmount), discountAmounts, successfulPaymentAmounts);
    }, 0);
  }

  /**
   * PRD FR9.4/FR9.5: total headcounts + enrollment composition + which
   * class arms have no active CLASS_TEACHER — the same "no DB constraint,
   * service-layer only" gap StaffAssignmentService.create's own comment
   * documents (co-teaching override means a missing class teacher is a
   * normal, expected state to surface, not an error).
   */
  async schoolComposition(user: RequestUser, academicSessionId: string) {
    this.assertAdminOrSuperAdmin(user);

    const [totalStudents, totalStaff, totalParents, classArms, studentDepartments] = await Promise.all([
      this.prisma.studentProfile.count({ where: { status: StudentStatus.ACTIVE, currentClass: { academicSessionId } } }),
      this.prisma.staffProfile.count({ where: { status: StaffStatus.ACTIVE } }),
      this.prisma.parentProfile.count(),
      this.prisma.classArm.findMany({
        where: { academicSessionId },
        include: {
          classLevel: { select: { name: true } },
          students: { where: { status: StudentStatus.ACTIVE }, select: { id: true } },
          staffAssignments: { where: { assignmentType: AssignmentType.CLASS_TEACHER, isActive: true }, select: { id: true } },
        },
      }),
      this.prisma.studentDepartment.findMany({
        where: { academicSessionId },
        include: { department: { select: { name: true } } },
      }),
    ]);

    const studentsByLevel = new Map<string, { classLevelId: string; name: string; count: number }>();
    for (const arm of classArms) {
      const existing = studentsByLevel.get(arm.classLevelId);
      const count = arm.students.length;
      if (existing) existing.count += count;
      else studentsByLevel.set(arm.classLevelId, { classLevelId: arm.classLevelId, name: arm.classLevel.name, count });
    }

    const studentsByDepartment = new Map<string, { departmentId: string; name: string; count: number }>();
    for (const row of studentDepartments) {
      const existing = studentsByDepartment.get(row.departmentId);
      if (existing) existing.count += 1;
      else studentsByDepartment.set(row.departmentId, { departmentId: row.departmentId, name: row.department.name, count: 1 });
    }

    const unfilledAssignmentGaps = classArms
      .filter((arm) => arm.staffAssignments.length === 0)
      .map((arm) => ({ classArmId: arm.id, className: `${arm.classLevel.name} ${arm.name}`, missing: ["CLASS_TEACHER"] as const }));

    return {
      totalStudents,
      totalStaff,
      totalParents,
      studentsByLevel: [...studentsByLevel.values()],
      studentsByDepartment: [...studentsByDepartment.values()],
      staffHeadcount: totalStaff,
      unfilledAssignmentGaps,
    };
  }

  /** PRD FR9.4: recent AuditLog rows — no read endpoint exists anywhere else for this table (see audit.interceptor.ts, write-only). */
  async auditHighlights(user: RequestUser, take: number) {
    this.assertSuperAdmin(user);

    const rows = await this.prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take,
      include: { actor: { select: { firstName: true, lastName: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      actorName: row.actor ? `${row.actor.firstName} ${row.actor.lastName}` : null,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
    }));
  }

  /** PRD FR9.4: invitation acceptance rate/time, bucketed by week and invited role. */
  async invitationTrend(user: RequestUser, weeks: number) {
    this.assertSuperAdmin(user);

    const since = new Date(Date.now() - weeks * 7 * 24 * 60 * 60 * 1000);
    const invitations = await this.prisma.invitation.findMany({
      where: { createdAt: { gte: since } },
      select: { invitedRole: true, createdAt: true, acceptedAt: true },
    });

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

  /**
   * PRD FR9.4/FR9.5/FR9.6: pending schedule generation approvals grouped by
   * scope. Reuses ScheduleGenerationRequestService's own
   * resolveTargetGroup/assertCanTrigger branching (§5 footnote 5) as a read
   * filter instead of a create-time gate — Super-Admin/Admin/Registrar see
   * every scope unscoped, a Principal-held assignment narrows to JSS_SSS-
   * derived requests, Headteacher to CRECHE_NURSERY_PRIMARY-derived ones.
   */
  async scheduleApprovalsSummary(user: RequestUser) {
    const isUnscoped =
      user.roles.includes("SUPER_ADMIN") || user.roles.includes("ADMIN") || user.assignmentTypes.includes("REGISTRAR");
    const isPrincipal = user.assignmentTypes.includes("PRINCIPAL");
    const isHeadteacher = user.assignmentTypes.includes("HEADTEACHER");
    if (!isUnscoped && !isPrincipal && !isHeadteacher) {
      throw new ForbiddenException("Insufficient permissions to view schedule approvals");
    }

    const scopeGroup = isUnscoped ? null : isPrincipal ? ClassLevelCategoryGroup.JSS_SSS : ClassLevelCategoryGroup.CRECHE_NURSERY_PRIMARY;

    const requests = await this.prisma.scheduleGenerationRequest.findMany({
      where: { reviewStatus: "PENDING_REVIEW" },
      select: {
        scope: true,
        classLevelCategoryGroup: true,
        classArm: { select: { classLevel: { select: { category: true } } } },
        assessmentComponent: { select: { classLevelCategory: true } },
      },
    });

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
}

// Sunday-anchored week bucket, UTC — consistent bucketing is all that
// matters here (a "week" isn't a business concept enforced elsewhere in the
// schema), not alignment with any particular school calendar convention.
function startOfWeek(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d;
}

@Controller("dashboard")
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get("finance-overview")
  financeOverview(@CurrentUser() user: RequestUser, @Query("termId") termId: string) {
    return this.service.financeOverview(user, termId);
  }

  @Get("school-composition")
  schoolComposition(@CurrentUser() user: RequestUser, @Query("academicSessionId") academicSessionId: string) {
    return this.service.schoolComposition(user, academicSessionId);
  }

  @Get("audit-highlights")
  auditHighlights(@CurrentUser() user: RequestUser, @Query("take") take?: string) {
    return this.service.auditHighlights(user, take === undefined ? 15 : Number(take));
  }

  @Get("invitation-trend")
  invitationTrend(@CurrentUser() user: RequestUser, @Query("weeks") weeks?: string) {
    return this.service.invitationTrend(user, weeks === undefined ? 8 : Number(weeks));
  }

  @Get("schedule-approvals-summary")
  scheduleApprovalsSummary(@CurrentUser() user: RequestUser) {
    return this.service.scheduleApprovalsSummary(user);
  }
}
