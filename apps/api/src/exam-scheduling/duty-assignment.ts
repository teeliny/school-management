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
import { ClassLevelCategoryGroup, Prisma, TimetableApprovalStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { Audited } from "../audit/audited.decorator";
import { UpdateDutyAssignmentDto } from "./dto/update-duty-assignment.dto";
import { SwapDutyAssignmentDto } from "./dto/swap-duty-assignment.dto";

/**
 * BUILD_PLAN.md §9 Step 6: DutyAssignment's first service/controller — Step
 * 5 only persisted rows via the callback controller, with no read/approve
 * surface yet. No assertNoConflicts here (unlike TimetableSlot/ExamSchedule/
 * InvigilationAssignment) — Step 5 established DutyAssignment has no
 * per-row overlap concept, only the DB's whole-week @@unique constraint.
 */
@Injectable()
export class DutyAssignmentService {
  constructor(private readonly prisma: PrismaService) {}

  // BUILD_PLAN.md §9 Step 6f: weekStartDateFrom/To narrow to one term's
  // weeks — needed because, unlike TimetableSlot/ExamSchedule/
  // InvigilationAssignment, DutyAssignment has no classArmId/
  // assessmentComponentId to scope a single generation run's rows by.
  findAll(filters: {
    classLevelCategoryGroup?: ClassLevelCategoryGroup;
    staffId?: string;
    approvalStatus?: TimetableApprovalStatus;
    weekStartDateFrom?: Date;
    weekStartDateTo?: Date;
  }) {
    const { weekStartDateFrom, weekStartDateTo, ...rest } = filters;
    return this.prisma.dutyAssignment.findMany({
      where: {
        ...rest,
        approvalStatus: filters.approvalStatus ?? TimetableApprovalStatus.APPROVED,
        weekStartDate:
          weekStartDateFrom || weekStartDateTo ? { gte: weekStartDateFrom, lte: weekStartDateTo } : undefined,
      },
      include: { staff: { include: { user: true } } },
      orderBy: [{ weekStartDate: "asc" }],
    });
  }

  // BUILD_PLAN.md §9 Step 6f: no assertNoConflicts-equivalent time-overlap
  // check is needed (weeks don't overlap the way exam times do) — the only
  // real risk from reassigning a row's staffId is the @@unique(
  // [weekStartDate, classLevelCategoryGroup, staffId]) constraint, guarded
  // explicitly here so it 400s cleanly instead of leaking a raw Prisma
  // P2002 to the client.
  private async assertNoUniqueCollision(
    weekStartDate: Date,
    classLevelCategoryGroup: ClassLevelCategoryGroup,
    staffId: string,
    excludeId: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const existing = await client.dutyAssignment.findFirst({
      where: { weekStartDate, classLevelCategoryGroup, staffId, id: { not: excludeId } },
    });
    if (existing) {
      throw new BadRequestException("Staff member already holds a duty slot for this week");
    }
  }

  // BUILD_PLAN.md §9 Step 6f: reassign via the grid's inline Select.
  async update(id: string, dto: UpdateDutyAssignmentDto) {
    const existing = await this.prisma.dutyAssignment.findUniqueOrThrow({ where: { id } });
    await this.assertNoUniqueCollision(existing.weekStartDate, existing.classLevelCategoryGroup, dto.staffId, id);
    return this.prisma.dutyAssignment.update({ where: { id }, data: { staffId: dto.staffId } });
  }

  // BUILD_PLAN.md §9 Step 6f: reassign via the grid's drag-and-drop, same
  // transactional swap shape as InvigilationAssignmentService.swap.
  async swap(idA: string, idB: string) {
    return this.prisma.$transaction(async (tx) => {
      const [rowA, rowB] = await Promise.all([
        tx.dutyAssignment.findUniqueOrThrow({ where: { id: idA } }),
        tx.dutyAssignment.findUniqueOrThrow({ where: { id: idB } }),
      ]);
      await this.assertNoUniqueCollision(rowA.weekStartDate, rowA.classLevelCategoryGroup, rowB.staffId, idA, tx);
      await this.assertNoUniqueCollision(rowB.weekStartDate, rowB.classLevelCategoryGroup, rowA.staffId, idB, tx);
      await tx.dutyAssignment.update({ where: { id: idA }, data: { staffId: rowB.staffId } });
      await tx.dutyAssignment.update({ where: { id: idB }, data: { staffId: rowA.staffId } });
      return { a: idA, b: idB };
    });
  }

}

/**
 * PRD footnote 4 states weekly-duty-roster approval as Admin-only; per an
 * explicit later decision, Super-Admin is allowed too — same
 * manual-role-check pattern as ExamScheduleController/
 * InvigilationAssignmentController.
 */
@Controller("duty-assignments")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class DutyAssignmentController {
  constructor(private readonly service: DutyAssignmentService) {}

  @Get()
  findAll(
    @CurrentUser() user: RequestUser,
    @Query("classLevelCategoryGroup") classLevelCategoryGroup?: ClassLevelCategoryGroup,
    @Query("staffId") staffId?: string,
    @Query("approvalStatus") approvalStatus?: TimetableApprovalStatus,
    @Query("weekStartDateFrom") weekStartDateFrom?: string,
    @Query("weekStartDateTo") weekStartDateTo?: string,
  ) {
    // Weekly duty is a staff-only rotation (gate/assembly/break duty) with
    // nothing a parent/student has a stake in — same "not this account
    // type" treatment as InvigilationAssignmentController, per PRD FR6.7's
    // invigilation precedent extended to this analogous roster.
    this.assertNotStudentOrParent(user);
    if (approvalStatus && approvalStatus !== TimetableApprovalStatus.APPROVED) {
      this.assertCanManage(user);
    }
    return this.service.findAll({
      classLevelCategoryGroup,
      staffId,
      approvalStatus,
      weekStartDateFrom: weekStartDateFrom ? new Date(weekStartDateFrom) : undefined,
      weekStartDateTo: weekStartDateTo ? new Date(weekStartDateTo) : undefined,
    });
  }

  // BUILD_PLAN.md §9 Step 6f: reassign via the grid's inline Select.
  @Patch(":id")
  @Audited("DutyAssignment", "dutyAssignment")
  update(@Param("id") id: string, @Body() dto: UpdateDutyAssignmentDto, @CurrentUser() user: RequestUser) {
    this.assertCanManage(user);
    return this.service.update(id, dto);
  }

  // BUILD_PLAN.md §9 Step 6f: reassign via the grid's drag-and-drop.
  @Patch(":id/swap")
  @Audited("DutyAssignment", "dutyAssignment")
  swap(@Param("id") id: string, @Body() dto: SwapDutyAssignmentDto, @CurrentUser() user: RequestUser) {
    this.assertCanManage(user);
    return this.service.swap(id, dto.withId);
  }

  // BUILD_PLAN.md §9 Step 6f: same actor set as the other three controllers'
  // assertCanManage — editing/viewing a draft is broader than approving one.
  private assertCanManage(user: RequestUser) {
    const isAdmin = user.roles.includes("ADMIN") || user.roles.includes("SUPER_ADMIN");
    const canManage =
      isAdmin ||
      user.assignmentTypes.includes("REGISTRAR") ||
      ["PRINCIPAL", "HEADTEACHER"].some((t) => user.assignmentTypes.includes(t));
    if (!canManage) {
      throw new ForbiddenException("Insufficient permissions to manage duty assignments");
    }
  }

  // Same "pure Student/Parent account excluded outright" rule as
  // InvigilationAssignmentController.assertNotStudentOrParent.
  private assertNotStudentOrParent(user: RequestUser) {
    const isStaffOrAdmin =
      user.roles.includes("STAFF") || user.roles.includes("ADMIN") || user.roles.includes("SUPER_ADMIN");
    if (!isStaffOrAdmin) {
      throw new ForbiddenException("Weekly duty rosters are not visible to this account type");
    }
  }
}
