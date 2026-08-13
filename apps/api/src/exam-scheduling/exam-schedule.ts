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
import { categoryToGroup, timeRangesOverlap } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { Audited } from "../audit/audited.decorator";
import { UpdateExamScheduleDto } from "./dto/update-exam-schedule.dto";
import { withDisplayName } from "../academic-structure/class-arm";

interface ExamConflictCheckInput {
  classArmId: string;
  date: Date;
  startTime: string;
  endTime: string;
}

/**
 * BUILD_PLAN.md §9 Step 3: no manual CRUD yet (read endpoints arrive with
 * Step 6/7's approval/overview UI, matching PRD's FR6.7 grouping) — this
 * exists purely to back `SchedulingCallbackController`'s persistence with
 * the same "conflict check as a final safety net on top of the solver's own
 * avoidance" pattern `TimetableSlotService.assertNoConflicts` established in
 * Step 2. Keyed by (classArmId, date) instead of (staffId/venue, dayOfWeek)
 * — `ExamSchedule` has no staffId (PRD §3.8: invigilation, Step 4, is a
 * separate staff pool not tied to the subject's own teacher).
 */
@Injectable()
export class ExamScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  async assertNoConflicts(
    input: ExamConflictCheckInput,
    excludeId?: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const sameDaySlots = await client.examSchedule.findMany({
      where: { classArmId: input.classArmId, date: input.date, id: excludeId ? { not: excludeId } : undefined },
    });
    for (const slot of sameDaySlots) {
      if (timeRangesOverlap(input.startTime, input.endTime, slot.startTime, slot.endTime)) {
        throw new BadRequestException(
          `Class arm already has an exam from ${slot.startTime} to ${slot.endTime} on this date`,
        );
      }
    }
  }

  // Same PARENT-scoping precedent as TimetableSlotService's own copy of this
  // helper (mirrors TermReportCardService.findForUser's StudentGuardian
  // join) — a parent may only ever see their own wards' exam schedules.
  private async resolveParentScopedClassArmIds(user: RequestUser): Promise<string[] | null> {
    if (!user.roles.includes("PARENT")) return null;
    const parentProfile = await this.prisma.parentProfile.findUnique({ where: { userId: user.id } });
    if (!parentProfile) return [];
    const wards = await this.prisma.studentProfile.findMany({
      where: { guardians: { some: { parentId: parentProfile.id } } },
      select: { currentClassId: true },
    });
    return wards.map((w) => w.currentClassId).filter((id): id is string => Boolean(id));
  }

  // Same "all classes" Principal→JSS/SSS / Headteacher→Creche/Nursery/
  // Primary scoping as TimetableSlotService's own copy — only applies when
  // no single classArmId was requested.
  private async resolveCategoryGroupScopedClassArmIds(user: RequestUser): Promise<string[] | null> {
    const isPrincipal = user.assignmentTypes.includes("PRINCIPAL");
    const isHeadteacher = user.assignmentTypes.includes("HEADTEACHER");
    if (!isPrincipal && !isHeadteacher) return null;
    if (user.roles.includes("SUPER_ADMIN") || user.assignmentTypes.includes("REGISTRAR")) return null;

    const allowedGroup = isPrincipal ? ClassLevelCategoryGroup.JSS_SSS : ClassLevelCategoryGroup.CRECHE_NURSERY_PRIMARY;
    const classArms = await this.prisma.classArm.findMany({
      select: { id: true, classLevel: { select: { category: true } } },
    });
    return classArms.filter((arm) => categoryToGroup(arm.classLevel.category) === allowedGroup).map((arm) => arm.id);
  }

  // BUILD_PLAN.md §9 Step 6: defaults to APPROVED-only, same "not visible
  // until approved" gate as TimetableSlotService.findAll — the controller
  // enforces the manage-check for any other approvalStatus value.
  async findAll(
    filters: { classArmId?: string; assessmentComponentId?: string; approvalStatus?: TimetableApprovalStatus },
    user?: RequestUser,
  ) {
    let classArmWhere: Prisma.ExamScheduleWhereInput["classArmId"] = filters.classArmId;

    if (user) {
      const parentScoped = await this.resolveParentScopedClassArmIds(user);
      if (parentScoped !== null) {
        if (filters.classArmId) {
          if (!parentScoped.includes(filters.classArmId)) return [];
        } else if (parentScoped.length === 0) {
          return [];
        } else {
          classArmWhere = { in: parentScoped };
        }
      } else if (!filters.classArmId) {
        const groupScoped = await this.resolveCategoryGroupScopedClassArmIds(user);
        if (groupScoped !== null) {
          if (groupScoped.length === 0) return [];
          classArmWhere = { in: groupScoped };
        }
      }
    }

    const rows = await this.prisma.examSchedule.findMany({
      where: {
        assessmentComponentId: filters.assessmentComponentId,
        classArmId: classArmWhere,
        approvalStatus: filters.approvalStatus ?? TimetableApprovalStatus.APPROVED,
      },
      include: { classArm: { include: { classLevel: { select: { name: true } } } }, subject: true },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
    });
    return rows.map((row) => ({ ...row, classArm: withDisplayName(row.classArm) }));
  }

  // BUILD_PLAN.md §9 Step 6d: drag (date/startTime/endTime) and inline-edit
  // (subjectId/venue) both funnel through this one PATCH — classArmId/
  // assessmentComponentId are deliberately not editable here, same as
  // TimetableSlot's drag-and-drop never re-parenting a slot to a different
  // class arm.
  async update(id: string, dto: UpdateExamScheduleDto) {
    const existing = await this.prisma.examSchedule.findUniqueOrThrow({ where: { id } });
    // class-transformer's plainToInstance populates every declared-but-unset
    // optional field on this hand-written DTO class as a literal `undefined`
    // own property (unlike PartialType-generated DTOs, e.g.
    // UpdateTimetableSlotDto, which don't) — spreading that straight over
    // `existing` would silently clobber real values with undefined. Filter
    // first so only fields actually present in this request participate in
    // the merge.
    const patch = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined));
    const merged = { ...existing, ...patch };
    await this.assertNoConflicts(merged, id);
    return this.prisma.examSchedule.update({ where: { id }, data: dto });
  }
}

/**
 * BUILD_PLAN.md §9 Step 6: read + approve/reject only — no manual create/
 * update/delete (unchanged from Step 3's "no manual CRUD yet" note; this
 * step adds the review-workflow surface, not general CRUD). Manual role
 * check, not @CheckPolicies. PRD footnote 4 states exam-schedule approval as
 * Admin-only; per an explicit later decision, Super-Admin is allowed too
 * (broader than the written spec) — nothing holds a broader "manage
 * ExamSchedule" CASL grant today to carve out from, but the same
 * manual-check pattern is used for consistency with TimetableSlotController.
 */
@Controller("exam-schedules")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class ExamScheduleController {
  constructor(private readonly service: ExamScheduleService) {}

  @Get()
  findAll(
    @CurrentUser() user: RequestUser,
    @Query("classArmId") classArmId?: string,
    @Query("assessmentComponentId") assessmentComponentId?: string,
    @Query("approvalStatus") approvalStatus?: TimetableApprovalStatus,
  ) {
    if (approvalStatus && approvalStatus !== TimetableApprovalStatus.APPROVED) {
      this.assertCanManage(user);
    }
    return this.service.findAll({ classArmId, assessmentComponentId, approvalStatus }, user);
  }

  // BUILD_PLAN.md §9 Step 6d: drag-and-drop/inline-edit in the new
  // exam-timetable grid. assertCanManage, not assertCanApprove — editing a
  // draft is a broader permission than approving one (same split
  // TimetableSlot already has between its CASL "manage" grant and the
  // Admin/Super-Admin-only approve/reject).
  @Patch(":id")
  @Audited("ExamSchedule", "examSchedule")
  update(@Param("id") id: string, @Body() dto: UpdateExamScheduleDto, @CurrentUser() user: RequestUser) {
    this.assertCanManage(user);
    return this.service.update(id, dto);
  }

  // BUILD_PLAN.md §9 Step 6d: no CASL "manage ExamSchedule" subject exists
  // (by design — see the class doc comment), so this mirrors
  // TimetableSlotController.assertCanManage's actor set directly: the same
  // group who can already trigger exam-timetable generation
  // (ScheduleGenerationRequestService.assertCanTrigger).
  private assertCanManage(user: RequestUser) {
    const isAdmin = user.roles.includes("ADMIN") || user.roles.includes("SUPER_ADMIN");
    const canManage =
      isAdmin ||
      user.assignmentTypes.includes("REGISTRAR") ||
      ["PRINCIPAL", "HEADTEACHER"].some((t) => user.assignmentTypes.includes(t));
    if (!canManage) {
      throw new ForbiddenException("Insufficient permissions to manage exam schedules");
    }
  }
}
