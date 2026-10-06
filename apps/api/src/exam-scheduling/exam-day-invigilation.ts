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
import { Prisma, TimetableApprovalStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { Audited } from "../audit/audited.decorator";
import { UpdateInvigilationAssignmentDto } from "./dto/update-invigilation-assignment.dto";
import { resolvePrincipalHeadteacherCategories } from "../common/class-level-category-scope";
import { resolveSitting } from "./exam-sitting";

/**
 * Mixed-hall (HALL_POOL_PER_DAY) invigilation duty — one row per (staff,
 * exam date) for a whole sitting, see the ExamDayInvigilation model comment.
 * Same read/reassign surface as InvigilationAssignmentService; approval and
 * rejection are whole-roster actions on ScheduleGenerationRequestService.
 */
@Injectable()
export class ExamDayInvigilationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A hall duty occupies the staff member's whole exam day, so it conflicts
   * with any other non-rejected invigilation that date — another hall duty
   * or any per-paper InvigilationAssignment.
   */
  async assertNoConflicts(
    staffId: string,
    date: Date,
    excludeId?: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const otherHallDuty = await client.examDayInvigilation.findFirst({
      where: {
        staffId,
        date,
        id: excludeId ? { not: excludeId } : undefined,
        approvalStatus: { not: TimetableApprovalStatus.REJECTED },
      },
    });
    if (otherHallDuty) {
      throw new BadRequestException("Staff member is already on hall invigilation duty on this date");
    }
    const paperDuty = await client.invigilationAssignment.findFirst({
      where: { staffId, approvalStatus: { not: TimetableApprovalStatus.REJECTED }, examSchedule: { date } },
    });
    if (paperDuty) {
      throw new BadRequestException("Staff member is already invigilating a class's exam on this date");
    }
  }

  // Same APPROVED-only default as InvigilationAssignmentService.findAll.
  // assessmentComponentId resolves to its whole sitting (a JSS/SSS hall
  // roster is stored against whichever of the two components it was
  // triggered for).
  async findAll(
    filters: { assessmentComponentId?: string; staffId?: string; approvalStatus?: TimetableApprovalStatus },
    user?: RequestUser,
  ) {
    const componentIds = filters.assessmentComponentId
      ? (await resolveSitting(this.prisma, filters.assessmentComponentId)).componentIds
      : undefined;
    const categories = user ? resolvePrincipalHeadteacherCategories(user) : null;

    return this.prisma.examDayInvigilation.findMany({
      where: {
        staffId: filters.staffId,
        assessmentComponentId: componentIds ? { in: componentIds } : undefined,
        approvalStatus: filters.approvalStatus ?? TimetableApprovalStatus.APPROVED,
        assessmentComponent: categories ? { classLevelCategory: { in: categories } } : undefined,
      },
      include: {
        staff: { include: { user: true } },
        assessmentComponent: { select: { id: true, name: true, type: true, classLevelCategory: true } },
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    });
  }

  async update(id: string, dto: UpdateInvigilationAssignmentDto) {
    const existing = await this.prisma.examDayInvigilation.findUniqueOrThrow({ where: { id } });
    await this.assertNoConflicts(dto.staffId, existing.date, id);
    return this.prisma.examDayInvigilation.update({ where: { id }, data: { staffId: dto.staffId } });
  }
}

@Controller("exam-day-invigilations")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class ExamDayInvigilationController {
  constructor(private readonly service: ExamDayInvigilationService) {}

  @Get()
  findAll(
    @CurrentUser() user: RequestUser,
    @Query("assessmentComponentId") assessmentComponentId?: string,
    @Query("staffId") staffId?: string,
    @Query("approvalStatus") approvalStatus?: TimetableApprovalStatus,
  ) {
    // Same visibility rule as invigilation-assignments (PRD FR6.7): staff/
    // admins only, never students or parents.
    const isStaffOrAdmin =
      user.roles.includes("STAFF") || user.roles.includes("ADMIN") || user.roles.includes("SUPER_ADMIN");
    if (!isStaffOrAdmin) {
      throw new ForbiddenException("Invigilation rosters are not visible to this account type");
    }
    if (approvalStatus && approvalStatus !== TimetableApprovalStatus.APPROVED) {
      this.assertCanManage(user);
    }
    return this.service.findAll({ assessmentComponentId, staffId, approvalStatus }, user);
  }

  @Patch(":id")
  @Audited("ExamDayInvigilation", "examDayInvigilation")
  update(@Param("id") id: string, @Body() dto: UpdateInvigilationAssignmentDto, @CurrentUser() user: RequestUser) {
    this.assertCanManage(user);
    return this.service.update(id, dto);
  }

  // Same actor set as InvigilationAssignmentController.assertCanManage.
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
}
