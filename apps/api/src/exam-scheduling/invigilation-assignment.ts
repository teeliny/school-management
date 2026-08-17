import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Param,
  Patch,
  Query,
  UseGuards,
} from "@nestjs/common";
import { InvigilationRole, Prisma, TimetableApprovalStatus } from "@prisma/client";
import { timeRangesOverlap } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { Audited } from "../audit/audited.decorator";
import { UpdateInvigilationAssignmentDto } from "./dto/update-invigilation-assignment.dto";
import { SwapInvigilationAssignmentDto } from "./dto/swap-invigilation-assignment.dto";
import { withDisplayName } from "../academic-structure/class-arm";

/**
 * BUILD_PLAN.md §9 Step 4: no manual CRUD yet (read endpoints arrive with
 * Step 6/7's approval/overview UI, same precedent as `ExamScheduleService`)
 * — exists purely to back `SchedulingCallbackController`'s persistence with
 * a final safety net on top of the solver's own no-double-booking
 * avoidance. Unlike `ExamScheduleService` (keyed by classArmId+date),
 * `InvigilationAssignment` conflicts are about the *staff member* being
 * double-booked across two exams — potentially different class arms — at
 * overlapping times on the same date.
 */
@Injectable()
export class InvigilationAssignmentService {
  constructor(private readonly prisma: PrismaService) {}

  async assertNoConflicts(
    staffId: string,
    examScheduleId: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const target = await client.examSchedule.findUniqueOrThrow({ where: { id: examScheduleId } });

    const otherAssignments = await client.invigilationAssignment.findMany({
      where: {
        staffId,
        examScheduleId: { not: examScheduleId },
        // Same reasoning as TimetableSlotService.assertNoConflicts — a
        // REJECTED row must not permanently block its slot from reuse.
        approvalStatus: { not: TimetableApprovalStatus.REJECTED },
      },
      include: { examSchedule: true },
    });

    for (const assignment of otherAssignments) {
      if (assignment.examSchedule.date.getTime() !== target.date.getTime()) continue;
      if (timeRangesOverlap(target.startTime, target.endTime, assignment.examSchedule.startTime, assignment.examSchedule.endTime)) {
        throw new BadRequestException(
          `Staff member is already invigilating another exam from ${assignment.examSchedule.startTime} to ${assignment.examSchedule.endTime} on this date`,
        );
      }
    }
  }

  /**
   * BUILD_PLAN.md §9 Step 6e: found during live verification — the CP-SAT
   * generator hard-enforces "a staff member holds at most one role per
   * exam" (invigilation.py's pairwise constraint), but the manual
   * update/swap paths had no equivalent check, so a grid edit could
   * silently put the same person in both LEAD and ASSISTANT for one exam.
   * assertNoConflicts alone doesn't catch this — it deliberately excludes
   * the target exam's own other role row (examScheduleId: {not:
   * examScheduleId}) since holding a role on this exam isn't itself a
   * conflict; only holding *both* roles on it is.
   */
  private async assertNotAlreadyOtherRole(
    staffId: string,
    examScheduleId: string,
    role: InvigilationRole,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const existing = await client.invigilationAssignment.findFirst({
      where: { examScheduleId, staffId, role: { not: role } },
    });
    if (existing) {
      throw new BadRequestException("Staff member already holds the other invigilation role for this exam");
    }
  }

  // BUILD_PLAN.md §9 Step 6: same APPROVED-only default as
  // ExamScheduleService/TimetableSlotService.findAll. assessmentComponentId
  // (Step 6e) is a relation filter — InvigilationAssignment has no such
  // column of its own, only via examSchedule.assessmentComponentId — so the
  // grid can fetch a whole component's roster (every arm) in one call,
  // matching how the queue already groups INVIGILATION batches by that key.
  async findAll(filters: {
    examScheduleId?: string;
    staffId?: string;
    assessmentComponentId?: string;
    approvalStatus?: TimetableApprovalStatus;
  }) {
    const { assessmentComponentId, ...rest } = filters;
    const rows = await this.prisma.invigilationAssignment.findMany({
      where: {
        ...rest,
        approvalStatus: filters.approvalStatus ?? TimetableApprovalStatus.APPROVED,
        examSchedule: assessmentComponentId ? { assessmentComponentId } : undefined,
      },
      include: {
        examSchedule: { include: { classArm: { include: { classLevel: { select: { name: true } } } }, subject: true } },
        staff: { include: { user: true } },
      },
      orderBy: [{ createdAt: "asc" }],
    });
    return rows.map((row) => ({
      ...row,
      examSchedule: { ...row.examSchedule, classArm: withDisplayName(row.examSchedule.classArm) },
    }));
  }

  // BUILD_PLAN.md §9 Step 6e: reassigning one fixed (examSchedule, role)
  // slot to a different staff member — a plain single-row update, no
  // uniqueness risk (examScheduleId/role never change).
  async update(id: string, dto: UpdateInvigilationAssignmentDto) {
    const existing = await this.prisma.invigilationAssignment.findUniqueOrThrow({ where: { id } });
    await this.assertNoConflicts(dto.staffId, existing.examScheduleId);
    await this.assertNotAlreadyOtherRole(dto.staffId, existing.examScheduleId, existing.role);
    return this.prisma.invigilationAssignment.update({ where: { id }, data: { staffId: dto.staffId } });
  }

  /**
   * BUILD_PLAN.md §9 Step 6e: dragging one assignment's staff card onto
   * another's cell swaps their staffId values — neither row's own
   * (examScheduleId, role) identity changes, so the @@unique constraint is
   * never at risk. Transactional, not two independent PATCH calls: if the
   * second update failed after the first succeeded, one staff member would
   * end up double-booked and the other's slot vacated — a real,
   * hard-to-recover inconsistency a plain sequential-calls approach can't
   * rule out.
   */
  async swap(idA: string, idB: string) {
    return this.prisma.$transaction(async (tx) => {
      const [rowA, rowB] = await Promise.all([
        tx.invigilationAssignment.findUniqueOrThrow({ where: { id: idA } }),
        tx.invigilationAssignment.findUniqueOrThrow({ where: { id: idB } }),
      ]);
      await this.assertNoConflicts(rowB.staffId, rowA.examScheduleId, tx);
      await this.assertNoConflicts(rowA.staffId, rowB.examScheduleId, tx);
      await this.assertNotAlreadyOtherRole(rowB.staffId, rowA.examScheduleId, rowA.role, tx);
      await this.assertNotAlreadyOtherRole(rowA.staffId, rowB.examScheduleId, rowB.role, tx);
      await tx.invigilationAssignment.update({ where: { id: idA }, data: { staffId: rowB.staffId } });
      await tx.invigilationAssignment.update({ where: { id: idB }, data: { staffId: rowA.staffId } });
      return { a: idA, b: idB };
    });
  }
}

/**
 * BUILD_PLAN.md §9 Step 6: read + approve/reject only, same "no manual CRUD
 * yet" precedent as ExamScheduleController. PRD footnote 4 states
 * invigilation-roster approval as Admin-only; per an explicit later
 * decision, Super-Admin is allowed too (see assertCanApprove below).
 */
@Controller("invigilation-assignments")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class InvigilationAssignmentController {
  constructor(private readonly service: InvigilationAssignmentService) {}

  @Get()
  findAll(
    @CurrentUser() user: RequestUser,
    @Query("examScheduleId") examScheduleId?: string,
    @Query("staffId") staffId?: string,
    @Query("assessmentComponentId") assessmentComponentId?: string,
    @Query("approvalStatus") approvalStatus?: TimetableApprovalStatus,
  ) {
    // PRD FR6.7: invigilation rosters are visible to assigned staff/
    // Registrar/Super-Admin/Admin — never to students or parents, unlike
    // TimetableSlot/ExamSchedule which those two roles do get (scoped to
    // their own class/wards). A user who also holds STAFF (e.g. a teacher
    // who's separately a parent) still passes.
    this.assertNotStudentOrParent(user);
    if (approvalStatus && approvalStatus !== TimetableApprovalStatus.APPROVED) {
      this.assertCanManage(user);
    }
    return this.service.findAll({ examScheduleId, staffId, assessmentComponentId, approvalStatus });
  }

  // BUILD_PLAN.md §9 Step 6e: reassign via the grid's inline Select.
  @Patch(":id")
  @Audited("InvigilationAssignment", "invigilationAssignment")
  update(@Param("id") id: string, @Body() dto: UpdateInvigilationAssignmentDto, @CurrentUser() user: RequestUser) {
    this.assertCanManage(user);
    return this.service.update(id, dto);
  }

  // BUILD_PLAN.md §9 Step 6e: reassign via the grid's drag-and-drop.
  @Patch(":id/swap")
  @Audited("InvigilationAssignment", "invigilationAssignment")
  swap(@Param("id") id: string, @Body() dto: SwapInvigilationAssignmentDto, @CurrentUser() user: RequestUser) {
    this.assertCanManage(user);
    return this.service.swap(id, dto.withId);
  }

  // BUILD_PLAN.md §9 Step 6e: same actor set as ExamScheduleController's
  // assertCanManage — editing/viewing a draft is broader than approving one.
  private assertCanManage(user: RequestUser) {
    const isAdmin = user.roles.includes("ADMIN") || user.roles.includes("SUPER_ADMIN");
    const canManage =
      isAdmin ||
      user.assignmentTypes.includes("REGISTRAR") ||
      ["PRINCIPAL", "HEADTEACHER"].some((t) => user.assignmentTypes.includes(t));
    if (!canManage) {
      throw new ForbiddenException("Insufficient permissions to manage invigilation assignments");
    }
  }

  // PRD FR6.7: a pure Student/Parent account (holding neither STAFF nor
  // ADMIN/SUPER_ADMIN) never sees this resource, regardless of
  // approvalStatus — unlike TimetableSlot/ExamSchedule's read endpoints,
  // which scope those two roles down to their own class/wards instead of
  // excluding them outright.
  private assertNotStudentOrParent(user: RequestUser) {
    const isStaffOrAdmin =
      user.roles.includes("STAFF") || user.roles.includes("ADMIN") || user.roles.includes("SUPER_ADMIN");
    if (!isStaffOrAdmin) {
      throw new ForbiddenException("Invigilation rosters are not visible to this account type");
    }
  }
}
