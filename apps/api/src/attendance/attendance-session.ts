import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { subject } from "@casl/ability";
import { AssignmentType, AttendancePersonType, AttendanceSessionKind, AttendanceSessionType, StaffStatus, StudentStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { AbilityFactory, type AppAbility } from "../casl/ability.factory";
import { StaffAssignmentService } from "../staff-assignments/staff-assignment";
import { SchoolProfileService } from "../academic-structure/school-profile";
import { AttendanceRecordInputDto, CreateAttendanceSessionDto } from "./dto/attendance-session.dto";

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AttendanceSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly staffAssignments: StaffAssignmentService,
    private readonly schoolProfile: SchoolProfileService,
  ) {}

  /**
   * PRD §3.7/§6.5 FR5.1/FR5.2: a class teacher records her class's daily
   * register, a subject teacher records her own period, Admin/Registrar
   * record STAFF-type (school-wide) attendance — or Admin/Super-Admin, any
   * time, as override (which also bypasses the back-dating window). Session
   * + its records are created together in one transaction: a register-
   * taking UI submits a whole class/day at once.
   */
  async create(dto: CreateAttendanceSessionDto, user: RequestUser, ability: AppAbility) {
    this.assertShapeConsistency(dto);

    const isAdminOverride = this.checkIsAdminOverride(ability);
    const takenByStaffId = await this.resolveTakenByStaffId(dto, user, ability, isAdminOverride);

    await this.assertWithinBackdateWindow(dto.date, isAdminOverride);
    await this.assertNoDuplicateSession(dto);
    const records = await this.buildValidatedRecords(dto);

    return this.prisma.$transaction(async (tx) => {
      const session = await tx.attendanceSession.create({
        data: {
          type: dto.type,
          kind: dto.kind,
          classArmId: dto.classArmId,
          date: dto.date,
          period: dto.period,
          subjectId: dto.subjectId,
          takenByStaffId,
        },
      });
      await tx.attendanceRecord.createMany({
        data: records.map((record) => ({ ...record, attendanceSessionId: session.id })),
      });
      return tx.attendanceSession.findUniqueOrThrow({ where: { id: session.id }, include: { records: true } });
    });
  }

  async findAll(
    filters: { classArmId?: string; type?: AttendanceSessionType; from?: Date; to?: Date },
    user: RequestUser,
    ability: AppAbility,
  ) {
    const classArmId = await this.resolveReadableClassArmFilter(filters.classArmId, user, ability);
    return this.prisma.attendanceSession.findMany({
      where: {
        type: filters.type,
        classArmId,
        date: filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined,
      },
      include: { records: true },
      orderBy: { date: "desc" },
    });
  }

  async findOne(id: string, user: RequestUser, ability: AppAbility) {
    const session = await this.prisma.attendanceSession.findUniqueOrThrow({
      where: { id },
      include: { records: true },
    });
    if (ability.can("read", "AttendanceSession")) return session;

    // STAFF-type sessions (classArmId null) are never visible to a plain
    // class/subject teacher — activeAssignedClassArmIds can never include
    // `null`, so this covers both "no classArmId" and "not my class arm".
    const allowedClassArmIds = await this.staffAssignments.activeAssignedClassArmIds(user.id);
    if (!session.classArmId || !allowedClassArmIds.includes(session.classArmId)) {
      throw new ForbiddenException("You do not have access to this attendance session");
    }
    return session;
  }

  /**
   * A bare-string `ability.can("manage", "AttendanceSession")` check ignores
   * field conditions entirely — there's no subject instance to test them
   * against, so CASL matches Registrar's `{type: "STAFF"}`-conditioned grant
   * too (confirmed empirically: it returns true for Registrar, not just
   * Admin). Checking against both known `type` values isolates the grant
   * that's genuinely unconditioned — only Admin/Super-Admin's applies to
   * both — which is what FR5.2's "without Admin override" needs.
   */
  private checkIsAdminOverride(ability: AppAbility): boolean {
    return (
      ability.can("manage", subject("AttendanceSession", { type: AttendanceSessionType.STUDENT })) &&
      ability.can("manage", subject("AttendanceSession", { type: AttendanceSessionType.STAFF }))
    );
  }

  private assertShapeConsistency(dto: CreateAttendanceSessionDto) {
    if (dto.type === AttendanceSessionType.STUDENT && !dto.classArmId) {
      throw new BadRequestException("classArmId is required for a STUDENT-type session");
    }
    if (dto.type === AttendanceSessionType.STAFF && dto.classArmId) {
      throw new BadRequestException("classArmId is not valid for a STAFF-type session — staff attendance is school-wide");
    }
    if (dto.kind === AttendanceSessionKind.PERIOD && !dto.subjectId) {
      throw new BadRequestException("subjectId is required for a PERIOD-kind session");
    }
    if (dto.kind === AttendanceSessionKind.DAILY && dto.subjectId) {
      throw new BadRequestException("subjectId is only valid for a PERIOD-kind session");
    }
  }

  private async resolveTakenByStaffId(
    dto: CreateAttendanceSessionDto,
    user: RequestUser,
    ability: AppAbility,
    isAdminOverride: boolean,
  ): Promise<string | null> {
    if (isAdminOverride) {
      const staffProfile = await this.prisma.staffProfile.findUnique({ where: { userId: user.id } });
      return staffProfile?.id ?? null;
    }

    if (dto.type === AttendanceSessionType.STAFF) {
      const isRegistrar = ability.can("manage", subject("AttendanceSession", { type: "STAFF" }));
      if (!isRegistrar) {
        throw new ForbiddenException("You are not permitted to record staff attendance");
      }
      const staffProfile = await this.prisma.staffProfile.findUnique({ where: { userId: user.id } });
      return staffProfile?.id ?? null;
    }

    const assignmentType = dto.kind === AttendanceSessionKind.DAILY ? AssignmentType.CLASS_TEACHER : AssignmentType.SUBJECT_TEACHER;
    const assignment = await this.staffAssignments.findActiveAssignment({
      userId: user.id,
      assignmentType,
      classArmId: dto.classArmId,
      subjectId: dto.kind === AttendanceSessionKind.PERIOD ? dto.subjectId : undefined,
    });
    if (!assignment) {
      throw new ForbiddenException(
        dto.kind === AttendanceSessionKind.DAILY
          ? "You are not the class teacher for this class"
          : "You are not the assigned subject teacher for this subject/class",
      );
    }
    return assignment.staffId;
  }

  private async assertWithinBackdateWindow(date: Date, isAdminOverride: boolean) {
    if (isAdminOverride) return;
    const profile = await this.schoolProfile.get();
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const earliestAllowed = new Date(today.getTime() - profile.attendanceBackdateWindowDays * DAY_MS);
    if (date.getTime() < earliestAllowed.getTime()) {
      throw new ForbiddenException(
        `Attendance cannot be recorded more than ${profile.attendanceBackdateWindowDays} day(s) in the past without Admin override`,
      );
    }
  }

  private async assertNoDuplicateSession(dto: CreateAttendanceSessionDto) {
    const existing = await this.prisma.attendanceSession.findFirst({
      where: {
        type: dto.type,
        kind: dto.kind,
        classArmId: dto.classArmId ?? null,
        date: dto.date,
        period: dto.period ?? null,
        subjectId: dto.subjectId ?? null,
      },
    });
    if (existing) {
      throw new ConflictException("An attendance session already exists for this class/date/period");
    }
  }

  private async buildValidatedRecords(
    dto: CreateAttendanceSessionDto,
  ): Promise<(AttendanceRecordInputDto & { personType: AttendancePersonType })[]> {
    const personIds = dto.records.map((r) => r.personId);
    if (new Set(personIds).size !== personIds.length) {
      throw new BadRequestException("Duplicate personId in records");
    }

    if (dto.type === AttendanceSessionType.STUDENT) {
      const students = await this.prisma.studentProfile.findMany({
        where: { id: { in: personIds }, currentClassId: dto.classArmId, status: StudentStatus.ACTIVE },
        select: { id: true },
      });
      this.assertAllFound(personIds, students, "These students are not active in this class");
      return dto.records.map((r) => ({ ...r, personType: AttendancePersonType.STUDENT }));
    }

    const staff = await this.prisma.staffProfile.findMany({
      where: { id: { in: personIds }, status: StaffStatus.ACTIVE },
      select: { id: true },
    });
    this.assertAllFound(personIds, staff, "These staff ids are not active");
    return dto.records.map((r) => ({ ...r, personType: AttendancePersonType.STAFF }));
  }

  private assertAllFound(personIds: string[], found: { id: string }[], message: string) {
    const validIds = new Set(found.map((f) => f.id));
    const invalid = personIds.filter((id) => !validIds.has(id));
    if (invalid.length > 0) {
      throw new BadRequestException(`${message}: ${invalid.join(", ")}`);
    }
  }

  private async resolveReadableClassArmFilter(
    requestedClassArmId: string | undefined,
    user: RequestUser,
    ability: AppAbility,
  ): Promise<string | { in: string[] } | undefined> {
    if (ability.can("read", "AttendanceSession")) {
      return requestedClassArmId;
    }
    const allowedClassArmIds = await this.staffAssignments.activeAssignedClassArmIds(user.id);
    if (requestedClassArmId) {
      if (!allowedClassArmIds.includes(requestedClassArmId)) {
        throw new ForbiddenException("You do not have access to this class's attendance records");
      }
      return requestedClassArmId;
    }
    return { in: allowedClassArmIds };
  }
}

@Controller("attendance-sessions")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class AttendanceSessionController {
  constructor(
    private readonly service: AttendanceSessionService,
    private readonly abilityFactory: AbilityFactory,
  ) {}

  @Post()
  create(@Body() dto: CreateAttendanceSessionDto, @CurrentUser() user: RequestUser) {
    const ability = this.abilityFactory.createForUser(user);
    return this.service.create(dto, user, ability);
  }

  @Get()
  findAll(
    @CurrentUser() user: RequestUser,
    @Query("classArmId") classArmId?: string,
    @Query("type") type?: AttendanceSessionType,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    const ability = this.abilityFactory.createForUser(user);
    return this.service.findAll(
      { classArmId, type, from: from ? new Date(from) : undefined, to: to ? new Date(to) : undefined },
      user,
      ability,
    );
  }

  @Get(":id")
  findOne(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    const ability = this.abilityFactory.createForUser(user);
    return this.service.findOne(id, user, ability);
  }
}
