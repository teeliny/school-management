import { Controller, Get, Injectable, Param, Query, UseGuards } from "@nestjs/common";
import { AttendancePersonType, AttendanceSessionType, AttendanceStatus, StudentStatus } from "@prisma/client";
import { computeAttendancePercentage, computeSchoolDaysOpened } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { SchoolProfileService } from "../academic-structure/school-profile";

type StatusCounts = { present: number; absent: number; late: number; excused: number };

@Injectable()
export class AttendanceAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly schoolProfile: SchoolProfileService,
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
