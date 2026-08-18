import { ForbiddenException, Injectable } from "@nestjs/common";
import { AssessmentComponentStatus, AssignmentType, AttendancePersonType, AttendanceSessionType, ClassLevelCategory, ClassLevelCategoryGroup, StaffStatus, StudentStatus } from "@prisma/client";
import { computeSchoolDaysOpened } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestUser } from "../auth/jwt.strategy";
import { StaffAssignmentService } from "../staff-assignments/staff-assignment";
import { BroadsheetService } from "../assessments/broadsheet";
import { SchoolProfileService } from "../academic-structure/school-profile";
import {
  aggregateClassDailyTrend,
  aggregateSchoolAttendance,
  bucketInvitationsByWeek,
  buildScoreEntryCompletionRows,
  computeGenderSplit,
  countScheduleApprovalsByScope,
  findUnfilledClassTeacherGaps,
  flattenScoreableSubjects,
  GATEWAY_METHODS,
  groupOutstandingByClass,
  groupStudentsByDepartment,
  groupStudentsByLevel,
  rankBroadsheetSnapshot,
  STUCK_THRESHOLD_MS,
  sumOutstandingBalances,
  summarizeStudentAttendance,
  tallyInvoicesByStatus,
} from "./dashboard.util";

/**
 * BUILD_PLAN.md §10 (Phase 8 — Dashboards): reads across every domain a
 * prior phase already built, so no single CASL "Subject" fits (see the
 * plan's callout on skipping CASL entirely for this module). Every method
 * here does its own manual `roles`/`assignmentTypes` branching or row-level
 * ownership check instead — mirroring TermReportCardService.findForUser and
 * ScheduleGenerationRequestService.assertCanTrigger's existing precedent.
 * Fetching lives here; the actual shaping/aggregation math is factored out
 * to dashboard.util.ts (same split as calendar.ts/calendar.util.ts).
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly staffAssignments: StaffAssignmentService,
    private readonly broadsheet: BroadsheetService,
    private readonly schoolProfile: SchoolProfileService,
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

    const statusGroups = await this.prisma.invoice.groupBy({ by: ["status"], where: { termId }, _count: true });

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
      outstandingByClass: groupOutstandingByClass(invoices),
      invoicesByStatus: tallyInvoicesByStatus(statusGroups),
      reconciliationStuckCount,
    };
  }

  private async sumOutstandingForTerm(termId: string): Promise<number> {
    const invoices = await this.prisma.invoice.findMany({
      where: { termId },
      select: { totalAmount: true, lineItems: { select: { amount: true, type: true } }, payments: { select: { amount: true, status: true } } },
    });
    return sumOutstandingBalances(invoices);
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

    return {
      totalStudents,
      totalStaff,
      totalParents,
      studentsByLevel: groupStudentsByLevel(classArms),
      studentsByDepartment: groupStudentsByDepartment(studentDepartments),
      staffHeadcount: totalStaff,
      unfilledAssignmentGaps: findUnfilledClassTeacherGaps(classArms),
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

    return bucketInvitationsByWeek(invitations);
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

    return countScheduleApprovalsByScope(requests, scopeGroup);
  }

  /**
   * PRD FR9.5: score-entry completion per class arm x subject x currently-
   * OPEN assessment component, for one classLevelCategory. One groupBy
   * against ScoreEntry rather than a loop of ScoreEntryService.summary per
   * cell (BUILD_PLAN.md §8 item 5's N+1 precedent) — a class-level-category
   * with 10 arms x 15 subjects x 2 open components is 300 summary calls
   * otherwise.
   */
  async scoreEntryCompletion(user: RequestUser, termId: string, classLevelCategory: ClassLevelCategory) {
    this.assertAdminOrSuperAdmin(user);

    const term = await this.prisma.term.findUniqueOrThrow({ where: { id: termId } });

    const openComponents = await this.prisma.assessmentComponent.findMany({
      where: { termId, classLevelCategory, status: AssessmentComponentStatus.OPEN },
      select: { id: true, name: true },
    });
    if (openComponents.length === 0) return [];

    const classArms = await this.prisma.classArm.findMany({
      where: { academicSessionId: term.academicSessionId, classLevel: { category: classLevelCategory } },
      include: {
        classLevel: { select: { name: true } },
        students: { where: { status: StudentStatus.ACTIVE }, select: { id: true } },
      },
    });
    if (classArms.length === 0) return [];

    const classSubjects = await this.prisma.classSubject.findMany({
      where: { classLevelCategory },
      include: {
        subject: {
          select: { id: true, name: true, isGroup: true, childSubjects: { select: { id: true, name: true } } },
        },
      },
    });
    const subjects = flattenScoreableSubjects(classSubjects);
    if (subjects.length === 0) return [];

    const classArmIds = classArms.map((a) => a.id);
    const subjectIds = subjects.map((s) => s.id);
    const componentIds = openComponents.map((c) => c.id);

    const counts = await this.prisma.scoreEntry.groupBy({
      by: ["classArmId", "subjectId", "assessmentComponentId"],
      where: { classArmId: { in: classArmIds }, subjectId: { in: subjectIds }, assessmentComponentId: { in: componentIds } },
      _count: true,
    });
    const countByKey = new Map(counts.map((c) => [`${c.classArmId}:${c.subjectId}:${c.assessmentComponentId}`, c._count]));

    return buildScoreEntryCompletionRows(classArms, subjects, openComponents, countByKey);
  }

  /**
   * PRD FR9.5 (Admin's "attendance anomalies, sorted worst-first") and
   * FR9.6's REGISTRAR addition (whole-school analytics by class + trend).
   */
  async attendanceOverview(user: RequestUser, termId: string) {
    if (
      !user.roles.includes("SUPER_ADMIN") &&
      !user.roles.includes("ADMIN") &&
      !user.assignmentTypes.includes("REGISTRAR")
    ) {
      throw new ForbiddenException("Only Admin, Super-Admin, or an active Registrar can view attendance analytics");
    }

    const term = await this.prisma.term.findUniqueOrThrow({ where: { id: termId } });
    const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
    const todayKey = today.toISOString().slice(0, 10);

    const classArms = await this.prisma.classArm.findMany({
      where: { academicSessionId: term.academicSessionId },
      include: { classLevel: { select: { name: true } } },
    });
    const classArmIds = classArms.map((a) => a.id);

    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        personType: AttendancePersonType.STUDENT,
        attendanceSession: {
          type: AttendanceSessionType.STUDENT,
          classArmId: { in: classArmIds },
          date: { gte: term.startDate, lte: today },
        },
      },
      select: { status: true, attendanceSession: { select: { date: true, classArmId: true } } },
    });

    return aggregateSchoolAttendance(records, classArms, todayKey);
  }

  /**
   * PRD FR9.6 CLASS_TEACHER addition: "Class attendance summary" — daily %
   * over the term for one class arm, the same records-taken-vs-present
   * methodology as attendanceOverview above, just scoped to a single arm
   * instead of aggregated school-wide. Also reachable by Admin/Super-Admin/
   * Registrar (consistent with attendanceOverview's own gate), since a
   * class teacher drilling into one arm is a strict narrowing of what those
   * roles can already see school-wide.
   */
  async classAttendanceDailyTrend(user: RequestUser, termId: string, classArmId: string) {
    const isSchoolWideRole =
      user.roles.includes("SUPER_ADMIN") || user.roles.includes("ADMIN") || user.assignmentTypes.includes("REGISTRAR");
    if (!isSchoolWideRole) {
      const assignment = await this.staffAssignments.findActiveAssignment({
        userId: user.id,
        assignmentType: AssignmentType.CLASS_TEACHER,
        classArmId,
      });
      if (!assignment) {
        throw new ForbiddenException("Only this class arm's active class teacher (or Admin/Super-Admin/Registrar) can view its attendance trend");
      }
    }

    const term = await this.prisma.term.findUniqueOrThrow({ where: { id: termId } });
    const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));

    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        personType: AttendancePersonType.STUDENT,
        attendanceSession: { type: AttendanceSessionType.STUDENT, classArmId, date: { gte: term.startDate, lte: today } },
      },
      select: { status: true, attendanceSession: { select: { date: true } } },
    });

    return { dailyTrend: aggregateClassDailyTrend(records) };
  }

  /** PRD FR9.6 CLASS_TEACHER addition: headcount + gender split for one class arm, gated to that arm's own active class teacher. */
  async classRosterSummary(user: RequestUser, classArmId: string) {
    const assignment = await this.staffAssignments.findActiveAssignment({
      userId: user.id,
      assignmentType: AssignmentType.CLASS_TEACHER,
      classArmId,
    });
    if (!assignment) {
      throw new ForbiddenException("Only this class arm's active class teacher can view its roster summary");
    }

    const students = await this.prisma.studentProfile.findMany({
      where: { currentClassId: classArmId, status: StudentStatus.ACTIVE },
      select: { user: { select: { gender: true } } },
    });

    return { headcount: students.length, genderSplit: computeGenderSplit(students) };
  }

  /**
   * PRD FR9.3/FR9.6 Principal/Headteacher addition: top-5/bottom-5 across
   * every class level in the caller's own class-level-category group
   * (JSS_SSS for Principal, CRECHE_NURSERY_PRIMARY for Headteacher),
   * computed live via BroadsheetService.build per class level and merged —
   * see the plan's explicit callout on why this is live-computed rather
   * than a stored cache (no persisted broadsheet snapshot exists anywhere
   * in the schema, and BUILD_PLAN.md forbids adding a new source-of-truth
   * table just to satisfy FR9.3's "cached" wording literally).
   */
  async broadsheetSnapshot(user: RequestUser, termId: string) {
    const isPrincipal = user.assignmentTypes.includes("PRINCIPAL");
    const isHeadteacher = user.assignmentTypes.includes("HEADTEACHER");
    if (!isPrincipal && !isHeadteacher) {
      throw new ForbiddenException("Only an active Principal or Headteacher can view the broadsheet snapshot");
    }

    const categories: ClassLevelCategory[] = isPrincipal
      ? [ClassLevelCategory.JSS, ClassLevelCategory.SSS]
      : [ClassLevelCategory.CRECHE, ClassLevelCategory.NURSERY, ClassLevelCategory.PRIMARY];
    const classLevels = await this.prisma.classLevel.findMany({ where: { category: { in: categories } } });

    const allRows = (
      await Promise.all(classLevels.map((level) => this.broadsheet.build({ classLevelId: level.id, termId })))
    ).flatMap((result) => result.rows);

    return rankBroadsheetSnapshot(allRows);
  }

  /**
   * PRD FR9.8/FR9.9: Parent's "Attendance summary" and Student's "Attendance
   * record" both want the same "% this term" self-check figure
   * AttendanceAnalyticsService.forStudent already computes — but that
   * controller route is CASL-gated to `read AttendanceSession`, which
   * Parent/Student are deliberately never granted (an unconditioned grant
   * would let either query any student's id, a real visibility leak). This
   * reimplements the same computeSchoolDaysOpened/computeAttendancePercentage
   * formula after a manual ownership check instead — own studentProfileId,
   * or a ward's via StudentGuardian — never proxying through the gated
   * controller.
   */
  async myAttendanceSummary(user: RequestUser, studentId: string, termId: string) {
    await this.assertCanViewStudent(user, studentId);

    const term = await this.prisma.term.findUniqueOrThrow({ where: { id: termId } });
    const [profile, holidays] = await Promise.all([
      this.schoolProfile.get(),
      this.prisma.schoolHoliday.findMany({ where: { date: { gte: term.startDate, lte: term.endDate } }, select: { date: true } }),
    ]);
    const opened = computeSchoolDaysOpened(
      { start: term.startDate, end: term.endDate },
      holidays.map((h) => h.date),
      profile.attendanceGranularity,
    );

    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        personId: studentId,
        personType: AttendancePersonType.STUDENT,
        attendanceSession: { type: AttendanceSessionType.STUDENT, date: { gte: term.startDate, lte: term.endDate } },
      },
      select: { status: true, attendanceSession: { select: { date: true } } },
      orderBy: { attendanceSession: { date: "desc" } },
    });

    return summarizeStudentAttendance(records, opened);
  }

  private async assertCanViewStudent(user: RequestUser, studentId: string) {
    if (user.roles.includes("SUPER_ADMIN") || user.roles.includes("ADMIN")) return;

    const studentProfile = await this.prisma.studentProfile.findUnique({ where: { userId: user.id } });
    if (studentProfile && studentProfile.id === studentId) return;

    const parentProfile = await this.prisma.parentProfile.findUnique({ where: { userId: user.id } });
    if (parentProfile) {
      const guardian = await this.prisma.studentGuardian.findUnique({
        where: { studentId_parentId: { studentId, parentId: parentProfile.id } },
      });
      if (guardian) return;
    }

    throw new ForbiddenException("You can only view your own or your ward's attendance");
  }
}
