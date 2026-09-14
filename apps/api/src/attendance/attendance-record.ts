import { BadRequestException, Body, Controller, ForbiddenException, Injectable, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { subject } from "@casl/ability";
import {
  AssignmentType,
  AttendancePersonType,
  AttendanceSession,
  AttendanceSessionKind,
  AttendanceSessionType,
  StaffStatus,
  StudentStatus,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { AbilityFactory, type AppAbility } from "../casl/ability.factory";
import { StaffAssignmentService } from "../staff-assignments/staff-assignment";
import { SchoolProfileService } from "../academic-structure/school-profile";
import { Audited } from "../audit/audited.decorator";
import { CreateAttendanceRecordDto, UpdateAttendanceRecordDto } from "./dto/attendance-record.dto";

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AttendanceRecordService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly staffAssignments: StaffAssignmentService,
    private readonly schoolProfile: SchoolProfileService,
  ) {}

  /**
   * Correcting a single student/staff's status/remark after the session was
   * taken — reloads the parent session and re-runs the same write-access and
   * back-date checks `AttendanceSessionService.create` applies, since a
   * record can't be more permissive to edit than the session was to create.
   */
  async update(id: string, dto: UpdateAttendanceRecordDto, user: RequestUser, ability: AppAbility) {
    const record = await this.prisma.attendanceRecord.findUniqueOrThrow({
      where: { id },
      include: { attendanceSession: true },
    });

    const isAdminOverride = this.checkIsAdminOverride(ability);
    if (!isAdminOverride) {
      await this.assertCanWriteSession(record.attendanceSession, user, ability);
      await this.assertWithinBackdateWindow(record.attendanceSession.date);
    }

    return this.prisma.attendanceRecord.update({ where: { id }, data: dto });
  }

  /**
   * Creates a record for a roster person missing one in an already-taken
   * session (e.g. never created, or lost) — gated by the exact same
   * write-access and back-date checks as `update`, so a person can't be
   * added to a session any more permissively than an existing record on it
   * can be corrected.
   */
  async create(dto: CreateAttendanceRecordDto, user: RequestUser, ability: AppAbility) {
    const session = await this.prisma.attendanceSession.findUniqueOrThrow({
      where: { id: dto.attendanceSessionId },
    });

    const isAdminOverride = this.checkIsAdminOverride(ability);
    if (!isAdminOverride) {
      await this.assertCanWriteSession(session, user, ability);
      await this.assertWithinBackdateWindow(session.date);
    }

    const personType = await this.assertPersonBelongsToSession(session, dto.personId);

    return this.prisma.attendanceRecord.create({
      data: {
        attendanceSessionId: session.id,
        personId: dto.personId,
        personType,
        status: dto.status,
        remark: dto.remark,
      },
    });
  }

  private async assertPersonBelongsToSession(session: AttendanceSession, personId: string): Promise<AttendancePersonType> {
    if (session.type === AttendanceSessionType.STAFF) {
      const staff = await this.prisma.staffProfile.findFirst({ where: { id: personId, status: StaffStatus.ACTIVE } });
      if (!staff) {
        throw new BadRequestException("This staff id is not active");
      }
      return AttendancePersonType.STAFF;
    }

    const student = await this.prisma.studentProfile.findFirst({
      where: { id: personId, currentClassId: session.classArmId, status: StudentStatus.ACTIVE },
    });
    if (!student) {
      throw new BadRequestException("This student is not active in this class");
    }
    return AttendancePersonType.STUDENT;
  }

  /**
   * A bare-string `ability.can("manage", "AttendanceSession")` check ignores
   * field conditions entirely — there's no subject instance to test them
   * against, so CASL matches Registrar's `{type: "STAFF"}`-conditioned grant
   * too (confirmed empirically, same finding as
   * `AttendanceSessionService.checkIsAdminOverride`). Checking against both
   * known `type` values isolates the grant that's genuinely unconditioned —
   * only Admin/Super-Admin's applies to both.
   */
  private checkIsAdminOverride(ability: AppAbility): boolean {
    return (
      ability.can("manage", subject("AttendanceSession", { type: AttendanceSessionType.STUDENT })) &&
      ability.can("manage", subject("AttendanceSession", { type: AttendanceSessionType.STAFF }))
    );
  }

  private async assertCanWriteSession(session: AttendanceSession, user: RequestUser, ability: AppAbility) {
    if (session.type === AttendanceSessionType.STAFF) {
      const isRegistrar = ability.can("manage", subject("AttendanceSession", { type: "STAFF" }));
      if (!isRegistrar) {
        throw new ForbiddenException("You are not permitted to correct staff attendance");
      }
      return;
    }

    const assignmentType = session.kind === AttendanceSessionKind.DAILY ? AssignmentType.CLASS_TEACHER : AssignmentType.SUBJECT_TEACHER;
    const assignment = await this.staffAssignments.findActiveAssignment({
      userId: user.id,
      assignmentType,
      classArmId: session.classArmId ?? undefined,
      subjectId: session.kind === AttendanceSessionKind.PERIOD ? (session.subjectId ?? undefined) : undefined,
    });
    if (!assignment) {
      throw new ForbiddenException(
        session.kind === AttendanceSessionKind.DAILY
          ? "You are not the class teacher for this class"
          : "You are not the assigned subject teacher for this subject/class",
      );
    }
  }

  private async assertWithinBackdateWindow(date: Date) {
    const profile = await this.schoolProfile.get();
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const earliestAllowed = new Date(today.getTime() - profile.attendanceBackdateWindowDays * DAY_MS);
    if (date.getTime() < earliestAllowed.getTime()) {
      throw new ForbiddenException(
        `This attendance session is more than ${profile.attendanceBackdateWindowDays} day(s) old — only Admin override can correct it now`,
      );
    }
  }
}

@Controller("attendance-records")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class AttendanceRecordController {
  constructor(
    private readonly service: AttendanceRecordService,
    private readonly abilityFactory: AbilityFactory,
  ) {}

  @Patch(":id")
  @Audited("AttendanceRecord", "attendanceRecord")
  update(@Param("id") id: string, @Body() dto: UpdateAttendanceRecordDto, @CurrentUser() user: RequestUser) {
    const ability = this.abilityFactory.createForUser(user);
    return this.service.update(id, dto, user, ability);
  }

  @Post()
  @Audited("AttendanceRecord", "attendanceRecord")
  create(@Body() dto: CreateAttendanceRecordDto, @CurrentUser() user: RequestUser) {
    const ability = this.abilityFactory.createForUser(user);
    return this.service.create(dto, user, ability);
  }
}
