import { Controller, ForbiddenException, Get, Injectable, Param, Query, UseGuards } from "@nestjs/common";
import {
  AttendanceGranularity,
  AttendancePersonType,
  AttendanceSessionKind,
  AttendanceSessionType,
  AttendanceStatus,
  ClassLevelCategory,
  StaffStatus,
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
import { resolvePrincipalHeadteacherCategories } from "../common/class-level-category-scope";

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
  async forStudent(studentId: string, termId: string, user: RequestUser) {
    await this.assertStudentInScope(user, studentId);
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

  async forClassArm(classArmId: string, termId: string, user: RequestUser) {
    await this.assertClassArmInScope(user, classArmId);
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

  /**
   * Whole-school staff counterpart to `forClassArm` above — every ACTIVE
   * staff member's present/absent/late/excused tally + percentage for the
   * term, plus a school-wide average. Gated at the controller by `read
   * AttendanceSession` (Super-Admin/Admin/Registrar/Principal/Headteacher/
   * Vice-Principal), the same set `forStaff`/`forClassArm` already use — no
   * further row-level narrowing, since (as with dailyStaffAttendanceIssues)
   * staff aren't modeled with any section key to scope by.
   */
  async forAllStaff(termId: string) {
    const term = await this.prisma.term.findUniqueOrThrow({ where: { id: termId } });
    const opened = await this.schoolDaysOpened(term.startDate, term.endDate);

    const staff = await this.prisma.staffProfile.findMany({
      where: { status: StaffStatus.ACTIVE },
      select: { id: true, employeeId: true, user: { select: { firstName: true, lastName: true } } },
      orderBy: { user: { lastName: "asc" } },
    });

    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        personType: AttendancePersonType.STAFF,
        attendanceSession: { type: AttendanceSessionType.STAFF, date: { gte: term.startDate, lte: term.endDate } },
      },
      select: { personId: true, status: true },
    });
    const recordsByStaff = new Map<string, { status: AttendanceStatus }[]>();
    for (const record of records) {
      const bucket = recordsByStaff.get(record.personId) ?? [];
      bucket.push(record);
      recordsByStaff.set(record.personId, bucket);
    }

    const perStaff = staff.map((s) => {
      const summary = summarize(recordsByStaff.get(s.id) ?? []);
      return {
        staffId: s.id,
        employeeId: s.employeeId,
        firstName: s.user.firstName,
        lastName: s.user.lastName,
        ...summary,
        percentage: computeAttendancePercentage(summary.present, opened),
      };
    });

    const presentTotal = perStaff.reduce((sum, s) => sum + s.present, 0);
    const possibleTotal = perStaff.length * opened;

    return {
      termId,
      schoolDaysOpened: opened,
      staff: perStaff,
      schoolAveragePercentage: computeAttendancePercentage(presentTotal, possibleTotal),
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
   * Staff-side counterpart to `dailyAttendanceIssues` below, flat rather than
   * class-arm-grouped since STAFF sessions are always school-wide (no
   * classArmId — see AttendanceSessionService.assertShapeConsistency) and
   * always DAILY (the frontend's STAFF_DAILY roll-call mode never splits by
   * MORNING/AFTERNOON the way STUDENT_DAILY can under
   * MORNING_AND_AFTERNOON granularity). Every ACTIVE staff member who is
   * ABSENT/LATE/EXCUSED or NOT_MARKED (no record at all, whether the
   * session was never taken or just this one person was left off it) — same
   * "PRESENT is never interesting" convention. Gated at the controller by
   * `read AttendanceSession` (Super-Admin/Admin/Registrar/Principal/
   * Headteacher/Vice-Principal) with no further row-level narrowing, unlike
   * the student version's Principal/Headteacher category scope — staff
   * aren't modeled with any equivalent section key to scope by.
   */
  async dailyStaffAttendanceIssues(dateStr: string) {
    const date = new Date(dateStr);

    const staff = await this.prisma.staffProfile.findMany({
      where: { status: StaffStatus.ACTIVE },
      select: { id: true, employeeId: true, user: { select: { firstName: true, lastName: true } } },
      orderBy: { user: { lastName: "asc" } },
    });

    const session = await this.prisma.attendanceSession.findFirst({
      where: { type: AttendanceSessionType.STAFF, kind: AttendanceSessionKind.DAILY, date },
      select: { id: true, records: { select: { personId: true, status: true, remark: true } } },
    });

    if (!session) {
      return {
        date: dateStr,
        sessionId: null,
        taken: false,
        entries: staff.map((s) => ({
          staffId: s.id,
          employeeId: s.employeeId,
          firstName: s.user.firstName,
          lastName: s.user.lastName,
          status: "NOT_MARKED" as DailyAttendanceIssueStatus,
          remark: null as string | null,
        })),
      };
    }

    const recordByStaff = new Map(session.records.map((r) => [r.personId, r]));
    return {
      date: dateStr,
      sessionId: session.id,
      taken: true,
      entries: staff
        .map((s) => {
          const record = recordByStaff.get(s.id);
          const status: AttendanceStatus | "NOT_MARKED" = record?.status ?? "NOT_MARKED";
          return {
            staffId: s.id,
            employeeId: s.employeeId,
            firstName: s.user.firstName,
            lastName: s.user.lastName,
            status,
            remark: record?.remark ?? null,
          };
        })
        .filter((entry): entry is typeof entry & { status: DailyAttendanceIssueStatus } => entry.status !== AttendanceStatus.PRESENT),
    };
  }

  /**
   * Lets any staff member check whether *their own* attendance has already
   * been marked for a given day — self-service, no CASL grant needed (a
   * plain teacher holds none on AttendanceSession at all), so a Principal/
   * Headteacher/Registrar running late can be nudged before the 9am lock
   * (assertStaffAttendanceNotLocked) closes the day out. Controller route
   * has no `@CheckPolicies` for the same reason `/students/wards` doesn't.
   */
  async myTodayStaffAttendanceStatus(user: RequestUser, dateStr: string) {
    const staffProfile = await this.prisma.staffProfile.findUnique({ where: { userId: user.id } });
    if (!staffProfile) throw new ForbiddenException("You have no staff profile to check attendance for");

    const date = new Date(dateStr);
    const record = await this.prisma.attendanceRecord.findFirst({
      where: {
        personId: staffProfile.id,
        personType: AttendancePersonType.STAFF,
        attendanceSession: { type: AttendanceSessionType.STAFF, kind: AttendanceSessionKind.DAILY, date },
      },
      select: { status: true, remark: true },
    });

    return { date: dateStr, marked: !!record, status: record?.status ?? null, remark: record?.remark ?? null };
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
          select: {
            id: true,
            admissionNumber: true,
            user: { select: { firstName: true, lastName: true } },
            guardians: {
              where: { isPrimaryContact: true },
              take: 1,
              select: { parent: { select: { user: { select: { phone: true } } } } },
            },
          },
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
                  guardianPhone: student.guardians[0]?.parent.user.phone ?? null,
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
                    guardianPhone: student.guardians[0]?.parent.user.phone ?? null,
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
    const categories = resolvePrincipalHeadteacherCategories(user);
    if (categories) return { type: "categories", categories };
    if (user.roles.includes("SUPER_ADMIN") || user.roles.includes("ADMIN") || user.assignmentTypes.includes("REGISTRAR")) {
      return { type: "categories", categories: [...CLASS_LEVEL_CATEGORIES] };
    }

    const classArmIds = await this.staffAssignments.activeClassTeacherClassArmIds(user.id);
    if (classArmIds.length === 0) {
      throw new ForbiddenException(
        "Only Super-Admin, Admin, Registrar, Principal, Headteacher, or an active class teacher can view the daily attendance list",
      );
    }
    return { type: "classArmIds", classArmIds };
  }

  // PRD §5 footnote 5-family split, extended to the per-student/per-class
  // sibling routes below (daily-issues already applied it) — a Principal/
  // Headteacher's unconditioned "manage AttendanceSession" CASL grant
  // otherwise let them pass any studentId/classArmId here, unscoped.
  private async assertStudentInScope(user: RequestUser, studentId: string): Promise<void> {
    const categories = resolvePrincipalHeadteacherCategories(user);
    if (!categories) return;
    const student = await this.prisma.studentProfile.findUniqueOrThrow({
      where: { id: studentId },
      include: { currentClass: { include: { classLevel: true } } },
    });
    if (!student.currentClass || !categories.includes(student.currentClass.classLevel.category)) {
      throw new ForbiddenException("This student is outside your assigned section");
    }
  }

  private async assertClassArmInScope(user: RequestUser, classArmId: string): Promise<void> {
    const categories = resolvePrincipalHeadteacherCategories(user);
    if (!categories) return;
    const classArm = await this.prisma.classArm.findUniqueOrThrow({ where: { id: classArmId }, include: { classLevel: true } });
    if (!categories.includes(classArm.classLevel.category)) {
      throw new ForbiddenException("This class arm is outside your assigned section");
    }
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
  forStudent(@Param("studentId") studentId: string, @Query("termId") termId: string, @CurrentUser() user: RequestUser) {
    return this.service.forStudent(studentId, termId, user);
  }

  @Get("class-arms/:classArmId")
  @CheckPolicies((ability) => ability.can("read", "AttendanceSession"))
  forClassArm(@Param("classArmId") classArmId: string, @Query("termId") termId: string, @CurrentUser() user: RequestUser) {
    return this.service.forClassArm(classArmId, termId, user);
  }

  @Get("staff")
  @CheckPolicies((ability) => ability.can("read", "AttendanceSession"))
  forAllStaff(@Query("termId") termId: string) {
    return this.service.forAllStaff(termId);
  }

  // Declared ahead of `staff/:staffId` so "daily-issues"/"me" are never
  // captured as a :staffId path param.
  @Get("staff/daily-issues")
  @CheckPolicies((ability) => ability.can("read", "AttendanceSession"))
  dailyStaffAttendanceIssues(@Query("date") date: string | undefined) {
    return this.service.dailyStaffAttendanceIssues(date ?? new Date().toISOString().slice(0, 10));
  }

  // No @CheckPolicies — self-service, same shape as `/students/wards`: any
  // staff member (no CASL grant on AttendanceSession required) can check
  // whether their own attendance has been marked yet.
  @Get("staff/me/today")
  myTodayStaffAttendanceStatus(@Query("date") date: string | undefined, @CurrentUser() user: RequestUser) {
    return this.service.myTodayStaffAttendanceStatus(user, date ?? new Date().toISOString().slice(0, 10));
  }

  @Get("staff/:staffId")
  @CheckPolicies((ability) => ability.can("read", "AttendanceSession"))
  forStaff(@Param("staffId") staffId: string, @Query("termId") termId: string) {
    return this.service.forStaff(staffId, termId);
  }
}
