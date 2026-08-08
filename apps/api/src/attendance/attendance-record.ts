import { Body, Controller, ForbiddenException, Injectable, Param, Patch, UseGuards } from "@nestjs/common";
import { subject } from "@casl/ability";
import { AssignmentType, AttendanceSession, AttendanceSessionKind, AttendanceSessionType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { AbilityFactory, type AppAbility } from "../casl/ability.factory";
import { StaffAssignmentService } from "../staff-assignments/staff-assignment";
import { SchoolProfileService } from "../academic-structure/school-profile";
import { UpdateAttendanceRecordDto } from "./dto/attendance-record.dto";

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
  update(@Param("id") id: string, @Body() dto: UpdateAttendanceRecordDto, @CurrentUser() user: RequestUser) {
    const ability = this.abilityFactory.createForUser(user);
    return this.service.update(id, dto, user, ability);
  }
}
