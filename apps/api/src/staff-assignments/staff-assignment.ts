import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { subject } from "@casl/ability";
import { AssignmentType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { AbilityFactory } from "../casl/ability.factory";
import { CreateStaffAssignmentDto, SyncSubjectTeacherAssignmentsDto } from "./dto/staff-assignment.dto";

@Injectable()
export class StaffAssignmentService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateStaffAssignmentDto) {
    if (dto.assignmentType === AssignmentType.CLASS_TEACHER && !dto.classArmId) {
      throw new BadRequestException("classArmId is required for a CLASS_TEACHER assignment");
    }

    if (dto.assignmentType === AssignmentType.CLASS_TEACHER && !dto.allowCoTeaching) {
      // PRD FR3.3: prevent two active class teachers on the same ClassArm+
      // session by default — a service-layer check, not a DB constraint, so
      // Admin can deliberately override via `allowCoTeaching`.
      const existing = await this.prisma.staffAssignment.findFirst({
        where: {
          classArmId: dto.classArmId,
          academicSessionId: dto.academicSessionId,
          assignmentType: AssignmentType.CLASS_TEACHER,
          isActive: true,
        },
      });
      if (existing) {
        throw new BadRequestException(
          "This class arm already has an active class teacher for this session — pass allowCoTeaching to override",
        );
      }
    }

    const assignment = await this.prisma.staffAssignment.create({
      data: {
        staffId: dto.staffId,
        assignmentType: dto.assignmentType,
        classArmId: dto.classArmId,
        subjectId: dto.subjectId,
        academicSessionId: dto.academicSessionId,
        startDate: dto.startDate,
        endDate: dto.endDate,
      },
    });

    if (assignment.assignmentType === AssignmentType.CLASS_TEACHER) {
      await this.prisma.staffProfile.update({
        where: { id: assignment.staffId },
        data: { isClassTeacher: true },
      });
    }

    return assignment;
  }

  async revoke(id: string) {
    const assignment = await this.prisma.staffAssignment.findUniqueOrThrow({ where: { id } });
    if (!assignment.isActive) {
      throw new BadRequestException("Assignment is already inactive");
    }

    const revoked = await this.prisma.staffAssignment.update({
      where: { id },
      data: { isActive: false, endDate: new Date() },
    });

    if (assignment.assignmentType === AssignmentType.CLASS_TEACHER) {
      const stillClassTeacher = await this.prisma.staffAssignment.findFirst({
        where: { staffId: assignment.staffId, assignmentType: AssignmentType.CLASS_TEACHER, isActive: true },
      });
      if (!stillClassTeacher) {
        await this.prisma.staffProfile.update({
          where: { id: assignment.staffId },
          data: { isClassTeacher: false },
        });
      }
    }

    return revoked;
  }

  findAll(staffId?: string) {
    return this.prisma.staffAssignment.findMany({
      where: staffId ? { staffId } : undefined,
      include: {
        subject: { select: { name: true } },
        classArm: { select: { name: true } },
        academicSession: { select: { name: true } },
        staff: { include: { user: { select: { firstName: true, lastName: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async findMine(userId: string) {
    const staffProfile = await this.prisma.staffProfile.findUnique({ where: { userId } });
    if (!staffProfile) return [];
    return this.prisma.staffAssignment.findMany({
      where: { staffId: staffProfile.id },
      orderBy: { createdAt: "desc" },
    });
  }

  findOne(id: string) {
    return this.prisma.staffAssignment.findUniqueOrThrow({ where: { id } });
  }

  /**
   * The reusable "is this user actively assigned to do X" lookup that
   * Phase 4's row-level checks (score entry, skill rating, class-teacher
   * comment) all need — resolves the user's StaffProfile, then their active
   * assignment matching the given type/subject/classArm. Returns null (not
   * throw) when there's no match, so callers can pass that straight into
   * their own ForbiddenException with a scenario-specific message.
   */
  async findActiveAssignment(filters: {
    userId: string;
    assignmentType: AssignmentType;
    subjectId?: string;
    classArmId?: string;
  }) {
    const staffProfile = await this.prisma.staffProfile.findUnique({ where: { userId: filters.userId } });
    if (!staffProfile) return null;

    return this.prisma.staffAssignment.findFirst({
      where: {
        staffId: staffProfile.id,
        assignmentType: filters.assignmentType,
        subjectId: filters.subjectId,
        classArmId: filters.classArmId,
        isActive: true,
      },
    });
  }

  /**
   * All class arms this user actively holds a CLASS_TEACHER or
   * SUBJECT_TEACHER assignment for — the same lookup StudentService.
   * findAllForUser (identity/students/student.ts) inlines for its own STAFF
   * branch, extracted here as a second consumer needs it (TermReportCard
   * staff visibility, PRD §5) without a third copy-paste.
   */
  async activeAssignedClassArmIds(userId: string): Promise<string[]> {
    const staffProfile = await this.prisma.staffProfile.findUnique({ where: { userId } });
    if (!staffProfile) return [];

    const assignments = await this.prisma.staffAssignment.findMany({
      where: {
        staffId: staffProfile.id,
        isActive: true,
        assignmentType: { in: [AssignmentType.CLASS_TEACHER, AssignmentType.SUBJECT_TEACHER] },
        classArmId: { not: null },
      },
    });

    return [...new Set(assignments.map((a) => a.classArmId).filter((id): id is string => id !== null))];
  }

  /**
   * Active SUBJECT_TEACHER class arm ids for one staff+subject+session —
   * used to pre-check the class-arm multi-select when the admin reopens the
   * assignment form for a combo they've already assigned before.
   */
  async findSubjectTeacherClassArmIds(filters: {
    staffId: string;
    subjectId: string;
    academicSessionId: string;
  }): Promise<string[]> {
    const rows = await this.prisma.staffAssignment.findMany({
      where: {
        staffId: filters.staffId,
        subjectId: filters.subjectId,
        academicSessionId: filters.academicSessionId,
        assignmentType: AssignmentType.SUBJECT_TEACHER,
        isActive: true,
      },
      select: { classArmId: true },
    });
    return rows.map((r) => r.classArmId).filter((id): id is string => id !== null);
  }

  /**
   * Reconciles a staff member's active SUBJECT_TEACHER assignments for one
   * subject+session down to exactly the submitted classArmIds set: newly
   * checked arms are added (or reactivated, if a revoked row already exists
   * for that exact key — see the partial unique index on staff_assignments,
   * which only guards active rows), unchecked ones are soft-revoked the same
   * way revoke() does (isActive:false + endDate, never hard-deleted) so
   * activeAssignedClassArmIds/findActiveAssignment callers see the shrink.
   * Manual find+diff rather than prisma.staffAssignment.upsert() because the
   * unique key is a raw partial index, not a schema-DSL @@unique Prisma's
   * typed upsert can target.
   */
  async syncSubjectTeacherAssignments(dto: SyncSubjectTeacherAssignmentsDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.staffAssignment.findMany({
        where: {
          staffId: dto.staffId,
          subjectId: dto.subjectId,
          academicSessionId: dto.academicSessionId,
          assignmentType: AssignmentType.SUBJECT_TEACHER,
          isActive: true,
        },
      });
      const desired = new Set(dto.classArmIds);
      const existingClassArmIds = new Set(existing.map((a) => a.classArmId));

      const toRevokeIds = existing.filter((a) => !a.classArmId || !desired.has(a.classArmId)).map((a) => a.id);
      if (toRevokeIds.length > 0) {
        await tx.staffAssignment.updateMany({
          where: { id: { in: toRevokeIds } },
          data: { isActive: false, endDate: new Date() },
        });
      }

      for (const classArmId of dto.classArmIds) {
        if (existingClassArmIds.has(classArmId)) continue;

        const revoked = await tx.staffAssignment.findFirst({
          where: {
            staffId: dto.staffId,
            subjectId: dto.subjectId,
            classArmId,
            academicSessionId: dto.academicSessionId,
            assignmentType: AssignmentType.SUBJECT_TEACHER,
            isActive: false,
          },
        });
        if (revoked) {
          await tx.staffAssignment.update({
            where: { id: revoked.id },
            data: { isActive: true, endDate: null, startDate: dto.startDate ?? revoked.startDate },
          });
        } else {
          await tx.staffAssignment.create({
            data: {
              staffId: dto.staffId,
              subjectId: dto.subjectId,
              classArmId,
              academicSessionId: dto.academicSessionId,
              assignmentType: AssignmentType.SUBJECT_TEACHER,
              startDate: dto.startDate,
            },
          });
        }
      }

      return tx.staffAssignment.findMany({
        where: {
          staffId: dto.staffId,
          subjectId: dto.subjectId,
          academicSessionId: dto.academicSessionId,
          assignmentType: AssignmentType.SUBJECT_TEACHER,
          isActive: true,
        },
      });
    });
  }
}

@Controller("staff-assignments")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class StaffAssignmentController {
  constructor(
    private readonly service: StaffAssignmentService,
    private readonly abilityFactory: AbilityFactory,
  ) {}

  @Post()
  async create(@Body() dto: CreateStaffAssignmentDto, @CurrentUser() user: RequestUser) {
    this.assertCanManage(user, dto.assignmentType);
    return this.service.create(dto);
  }

  @Get()
  findAll(@CurrentUser() user: RequestUser, @Query("staffId") staffId?: string) {
    const ability = this.abilityFactory.createForUser(user);
    if (!ability.can("manage", "StaffAssignment")) {
      throw new ForbiddenException("Insufficient permissions");
    }
    return this.service.findAll(staffId);
  }

  @Get("mine")
  findMine(@CurrentUser() user: RequestUser) {
    return this.service.findMine(user.id);
  }

  @Get("subject-teacher")
  findSubjectTeacherClassArmIds(
    @CurrentUser() user: RequestUser,
    @Query("staffId") staffId: string,
    @Query("subjectId") subjectId: string,
    @Query("academicSessionId") academicSessionId: string,
  ) {
    this.assertCanManage(user, AssignmentType.SUBJECT_TEACHER);
    return this.service.findSubjectTeacherClassArmIds({ staffId, subjectId, academicSessionId });
  }

  @Post("subject-teacher/sync")
  syncSubjectTeacher(@Body() dto: SyncSubjectTeacherAssignmentsDto, @CurrentUser() user: RequestUser) {
    this.assertCanManage(user, AssignmentType.SUBJECT_TEACHER);
    return this.service.syncSubjectTeacherAssignments(dto);
  }

  @Patch(":id/revoke")
  async revoke(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    const assignment = await this.service.findOne(id);
    this.assertCanManage(user, assignment.assignmentType);
    return this.service.revoke(id);
  }

  private assertCanManage(user: RequestUser, assignmentType: AssignmentType) {
    const ability = this.abilityFactory.createForUser(user);
    if (!ability.can("manage", subject("StaffAssignment", { assignmentType }))) {
      // PRD FR3.1: BURSAR/REGISTRAR assignments are Super-Admin only.
      throw new ForbiddenException(
        "Insufficient permissions to manage this assignment type",
      );
    }
  }
}
