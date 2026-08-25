import { Controller, ForbiddenException, Get, Injectable, Param, Query, UseGuards } from "@nestjs/common";
import {
  AttendanceGranularity,
  AttendancePersonType,
  AttendanceSessionKind,
  AttendanceSessionType,
  AttendanceStatus,
  ClassLevelCategory,
  StudentStatus,
} from "@prisma/client";
import { CLASS_LEVEL_CATEGORIES, computeAttendancePercentage, computeSchoolDaysOpened } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { SchoolProfileService } from "../academic-structure/school-profile";
import { StaffAssignmentService } from "../staff-assignments/staff-assignment";

type StatusCounts = { present: number; absent: number; late: number; excused: number };

// "NOT_MARKED" isn't a stored AttendanceStatus — it's synthesized in
// dailyAttendanceIssues for a student with no AttendanceRecord at all for the
// day (either the class's register was never taken, or that one student was
// left out of it), same "PRESENT" is deliberately excluded from
// dailyAttendanceIssues either way — a full present roster isn't useful.
export type DailyAttendanceIssueStatus = "ABSENT" | "LATE" | "EXCUSED" | "NOT_MARKED";

@Injectable()
export class AttendanceAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly schoolProfile: SchoolProfileService,
    private readonly staffAssignments: StaffAssignmentService,
  ) {}

  // PRD §6.5 FR5.3: Admin/Registrar view attendance analytics per student,
  // per class, per staff — each expressed against the same "school days
  // opened" denominator (packages/types' computeSchoolDaysOpened), which the
  // FULL_TERM report card's (currently deferred) attendance line will
  // eventually reuse.
  async forStudent(studentId: string, termId: string) {
    const term = await this.prisma.term.findUniqueOrThrow({ where: { id: termId } });
    const opened = await this.schoolDaysOpened(term.startDate, term.endDate);

    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        personId: studentId,
        personType: AttendancePersonType.STUDENT,
        attendanceSession: { type: AttendanceSessionType.STUDENT, date: { gte: term.startDate, lte: term.endDate } },
      },
      select: { status: true },
    });
    const summary = summarize(records);

    return { studentId, termId, schoolDaysOpened: opened, ...summary, percentage: computeAttendancePercentage(summary.present, opened) };
  }

  async forClassArm(classArmId: string, termId: string) {
    const term = await this.prisma.term.findUniqueOrThrow({ where: { id: termId } });
    const opened = await this.schoolDaysOpened(term.startDate, term.endDate);

    const students = await this.prisma.studentProfile.findMany({
      where: { currentClassId: classArmId, status: StudentStatus.ACTIVE },
      select: { id: true, admissionNumber: true, user: { select: { firstName: true, lastName: true } } },
      orderBy: { user: { lastName: "asc" } },
    });

    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        personType: AttendancePersonType.STUDENT,
        attendanceSession: { type: AttendanceSessionType.STUDENT, classArmId, date: { gte: term.startDate, lte: term.endDate } },
      },
      select: { personId: true, status: true },
    });
    const recordsByStudent = new Map<string, { status: AttendanceStatus }[]>();
    for (const record of records) {
      const bucket = recordsByStudent.get(record.personId) ?? [];
      bucket.push(record);
      recordsByStudent.set(record.personId, bucket);
    }

    const perStudent = students.map((student) => {
      const summary = summarize(recordsByStudent.get(student.id) ?? []);
      return {
        studentId: student.id,
        admissionNumber: student.admissionNumber,
        firstName: student.user.firstName,
        lastName: student.user.lastName,
        ...summary,
        percentage: computeAttendancePercentage(summary.present, opened),
      };
    });

    const classPresentTotal = perStudent.reduce((sum, s) => sum + s.present, 0);
    const classPossibleTotal = perStudent.length * opened;

    return {
      classArmId,
      termId,
      schoolDaysOpened: opened,
      students: perStudent,
      classAveragePercentage: computeAttendancePercentage(classPresentTotal, classPossibleTotal),
    };
  }

  async forStaff(staffId: string, termId: string) {
    const term = await this.prisma.term.findUniqueOrThrow({ where: { id: termId } });
    const opened = await this.schoolDaysOpened(term.startDate, term.endDate);

    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        personId: staffId,
        personType: AttendancePersonType.STAFF,
        attendanceSession: { type: AttendanceSessionType.STAFF, date: { gte: term.startDate, lte: term.endDate } },
      },
      select: { status: true },
    });
    const summary = summarize(records);

    return { staffId, termId, schoolDaysOpened: opened, ...summary, percentage: computeAttendancePercentage(summary.present, opened) };
  }

  /**
   * Daily class-by-class "needs attention" roll — every active student who
   * is ABSENT/LATE/EXCUSED or NOT_MARKED (no record at all, whether because
   * the whole register was never taken or that one student was skipped),
   * for the "who's out / who's late / who hasn't been marked today" list.
   * PRESENT students are deliberately never included. Super-Admin/Admin/
   * Registrar see every class arm; a Principal/Headteacher-held assignment
   * narrows to that title's class-level category (JSS/SSS vs CRECHE/NURSERY/
   * PRIMARY), same mapping as
   * ScheduleGenerationRequestService.resolveAllowedCategoriesFromUser and
   * DashboardService.scheduleApprovalsSummary; a class teacher (no CASL
   * grant on AttendanceSession at all — only Super-Admin/Admin/Registrar/
   * Principal/Headteacher hold that) is narrowed instead to exactly the
   * class arm(s) they actively hold a CLASS_TEACHER assignment for, same
   * shape as DashboardService.classAttendanceDailyTrend's own class-teacher
   * carve-out. Scoped entirely at the service layer — the controller route
   * below has no `@CheckPolicies` guard, so resolveScopeForUser is this
   * endpoint's only access check, and it throws for anyone who's none of
   * the above.
   *
   * Expects one DAILY session per class arm under DAILY granularity, or two
   * (period MORNING/AFTERNOON) under MORNING_AND_AFTERNOON — mirroring the
   * roll-call UI's own `needsGranularityPeriod` split (attendance/page.tsx).
   * A missing expected session means every active student in that class arm
   * is NOT_MARKED for that period, not just silently absent from the list.
   */
  async dailyAttendanceIssues(dateStr: string, user: RequestUser) {
    const date = new Date(dateStr);
    const scope = await this.resolveScopeForUser(user);
    const profile = await this.schoolProfile.get();
    const expectedPeriods: (string | null)[] =
      profile.attendanceGranularity === AttendanceGranularity.MORNING_AND_AFTERNOON ? ["MORNING", "AFTERNOON"] : [null];

    const classArms = await this.prisma.classArm.findMany({
      where: {
        academicSession: { isCurrent: true },
        ...(scope.type === "categories" ? { classLevel: { category: { in: scope.categories } } } : { id: { in: scope.classArmIds } }),
      },
      select: {
        id: true,
        name: true,
        classLevel: { select: { name: true, order: true } },
        students: {
          where: { status: StudentStatus.ACTIVE },
          select: { id: true, admissionNumber: true, user: { select: { firstName: true, lastName: true } } },
          orderBy: { user: { lastName: "asc" } },
        },
      },
      orderBy: [{ classLevel: { order: "asc" } }, { name: "asc" }],
    });

    const sessions = await this.prisma.attendanceSession.findMany({
      where: {
        type: AttendanceSessionType.STUDENT,
        kind: AttendanceSessionKind.DAILY,
        classArmId: { in: classArms.map((arm) => arm.id) },
        date,
      },
      select: { id: true, classArmId: true, period: true, records: { select: { personId: true, status: true, remark: true } } },
    });
    const sessionByClassArmAndPeriod = new Map<string, Map<string | null, (typeof sessions)[number]>>();
    for (const session of sessions) {
      if (!session.classArmId) continue;
      const byPeriod = sessionByClassArmAndPeriod.get(session.classArmId) ?? new Map();
      byPeriod.set(session.period, session);
      sessionByClassArmAndPeriod.set(session.classArmId, byPeriod);
    }

    return {
      date: dateStr,
      classArms: classArms.map((arm) => {
        const byPeriod = sessionByClassArmAndPeriod.get(arm.id);
        return {
          classArmId: arm.id,
          className: `${arm.classLevel.name} ${arm.name}`,
          sessions: expectedPeriods.map((period) => {
            const session = byPeriod?.get(period);
            if (!session) {
              return {
                sessionId: null,
                period,
                taken: false,
                entries: arm.students.map((student) => ({
                  studentId: student.id,
                  admissionNumber: student.admissionNumber,
                  firstName: student.user.firstName,
                  lastName: student.user.lastName,
                  status: "NOT_MARKED" as DailyAttendanceIssueStatus,
                  remark: null as string | null,
                })),
              };
            }

            const recordByStudent = new Map(session.records.map((r) => [r.personId, r]));
            return {
              sessionId: session.id,
              period,
              taken: true,
              entries: arm.students
                .map((student) => {
                  const record = recordByStudent.get(student.id);
                  const status: AttendanceStatus | "NOT_MARKED" = record?.status ?? "NOT_MARKED";
                  return {
                    studentId: student.id,
                    admissionNumber: student.admissionNumber,
                    firstName: student.user.firstName,
                    lastName: student.user.lastName,
                    status,
                    remark: record?.remark ?? null,
                  };
                })
                .filter(
                  (entry): entry is typeof entry & { status: DailyAttendanceIssueStatus } => entry.status !== AttendanceStatus.PRESENT,
                ),
            };
          }),
        };
      }),
    };
  }

  private async resolveScopeForUser(
    user: RequestUser,
  ): Promise<{ type: "categories"; categories: ClassLevelCategory[] } | { type: "classArmIds"; classArmIds: string[] }> {
    if (user.roles.includes("SUPER_ADMIN") || user.roles.includes("ADMIN") || user.assignmentTypes.includes("REGISTRAR")) {
      return { type: "categories", categories: [...CLASS_LEVEL_CATEGORIES] };
    }
    if (user.assignmentTypes.includes("PRINCIPAL")) return { type: "categories", categories: [ClassLevelCategory.JSS, ClassLevelCategory.SSS] };
    if (user.assignmentTypes.includes("HEADTEACHER")) {
      return { type: "categories", categories: [ClassLevelCategory.CRECHE, ClassLevelCategory.NURSERY, ClassLevelCategory.PRIMARY] };
    }

    const classArmIds = await this.staffAssignments.activeClassTeacherClassArmIds(user.id);
    if (classArmIds.length === 0) {
      throw new ForbiddenException(
        "Only Super-Admin, Admin, Registrar, Principal, Headteacher, or an active class teacher can view the daily attendance list",
      );
    }
    return { type: "classArmIds", classArmIds };
  }

  private async schoolDaysOpened(start: Date, end: Date): Promise<number> {
    const [profile, holidays] = await Promise.all([
      this.schoolProfile.get(),
      this.prisma.schoolHoliday.findMany({ where: { date: { gte: start, lte: end } }, select: { date: true } }),
    ]);
    return computeSchoolDaysOpened({ start, end }, holidays.map((h) => h.date), profile.attendanceGranularity);
  }
}

function summarize(records: { status: AttendanceStatus }[]): StatusCounts {
  const counts: StatusCounts = { present: 0, absent: 0, late: 0, excused: 0 };
  for (const record of records) {
    if (record.status === AttendanceStatus.PRESENT) counts.present += 1;
    else if (record.status === AttendanceStatus.ABSENT) counts.absent += 1;
    else if (record.status === AttendanceStatus.LATE) counts.late += 1;
    else counts.excused += 1;
  }
  return counts;
}

@Controller("attendance/analytics")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class AttendanceAnalyticsController {
  constructor(private readonly service: AttendanceAnalyticsService) {}

  // No @CheckPolicies here — a class teacher (who reaches this route for
  // their own class arm) holds no CASL grant on AttendanceSession at all
  // (only Super-Admin/Admin/Registrar/Principal/Headteacher do), so the
  // access check has to live in the service instead
  // (AttendanceAnalyticsService.resolveScopeForUser), same shape as
  // DashboardService.classAttendanceDailyTrend.
  @Get("daily-issues")
  dailyAttendanceIssues(@Query("date") date: string | undefined, @CurrentUser() user: RequestUser) {
    return this.service.dailyAttendanceIssues(date ?? new Date().toISOString().slice(0, 10), user);
  }

  @Get("students/:studentId")
  @CheckPolicies((ability) => ability.can("read", "AttendanceSession"))
  forStudent(@Param("studentId") studentId: string, @Query("termId") termId: string) {
    return this.service.forStudent(studentId, termId);
  }

  @Get("class-arms/:classArmId")
  @CheckPolicies((ability) => ability.can("read", "AttendanceSession"))
  forClassArm(@Param("classArmId") classArmId: string, @Query("termId") termId: string) {
    return this.service.forClassArm(classArmId, termId);
  }

  @Get("staff/:staffId")
  @CheckPolicies((ability) => ability.can("read", "AttendanceSession"))
  forStaff(@Param("staffId") staffId: string, @Query("termId") termId: string) {
    return this.service.forStaff(staffId, termId);
  }
}
