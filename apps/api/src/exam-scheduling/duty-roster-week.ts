import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import {
  AssignmentType,
  ClassLevelCategory,
  ClassLevelCategoryGroup,
  ScheduleGenerationStatus,
  ScheduleScope,
  TimetableApprovalStatus,
  TimetableGeneratedBy,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { Audited } from "../audit/audited.decorator";
import { GenerateDutyRosterDto } from "./dto/generate-duty-roster.dto";
import { UpsertDutyRosterWeekDto } from "./dto/upsert-duty-roster-week.dto";

/**
 * The manual counterpart to the OR-Tools WEEKLY_DUTY solve (BUILD_PLAN.md
 * §9 Step 5) — added per an explicit product decision (2026-09-22) that the
 * AI solver is overkill for a roster that's really just "round-robin N
 * teachers per week, let Admin fill in a topic per week afterward." Runs
 * entirely synchronously in the API (no BullMQ/Python involved), but still
 * produces a `ScheduleGenerationRequest` row so its DutyAssignment rows flow
 * through the exact same PENDING_REVIEW → Super-Admin approve/reject
 * pipeline an AI run uses (see the schema comment on
 * ScheduleGenerationRequest.dutyAssignments) — SchedulingApprovalsQueue and
 * ScheduleGenerationRequestController need zero changes to pick these up.
 */
@Injectable()
export class DutyRosterWeekService {
  constructor(private readonly prisma: PrismaService) {}

  // Same UTC-anchored Monday-stepping arithmetic as
  // SchedulingSolveDispatchProcessor.resolveWeekStartDates — duplicated
  // rather than shared since that method lives in apps/worker, not
  // reachable from apps/api.
  private resolveWeeks(startDate: Date, endDate: Date): Date[] {
    const weeks: Date[] = [];
    const cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()));
    const endUtc = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate());
    while (cursor.getTime() <= endUtc) {
      weeks.push(new Date(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
    return weeks;
  }

  // Same pool definition as SchedulingSolveDispatchProcessor.
  // resolveEligibleDutyStaffIds (FR6.11): active CLASS_TEACHER/
  // SUBJECT_TEACHER holders scoped to the group's categories, minus
  // whichever assignmentTypes the WEEKLY_DUTY EXCLUDED_DUTY_ASSIGNMENT_TYPES
  // constraint lists.
  private async resolveEligibleStaffIds(group: ClassLevelCategoryGroup): Promise<string[]> {
    const categories: ClassLevelCategory[] =
      group === "JSS_SSS" ? ["JSS", "SSS"] : ["CRECHE", "RECEPTION", "NURSERY", "PRIMARY"];

    const globalConstraints = await this.prisma.schedulingConstraint.findMany({
      where: { scope: ScheduleScope.WEEKLY_DUTY, classLevelCategoryGroup: null, isActive: true },
    });
    const excludedTypes =
      (globalConstraints.find((c) => c.key === "EXCLUDED_DUTY_ASSIGNMENT_TYPES")?.value as string[] | undefined) ?? [];

    const excludedStaffIds = new Set(
      (
        await this.prisma.staffAssignment.findMany({
          where: { assignmentType: { in: excludedTypes as AssignmentType[] }, isActive: true },
          select: { staffId: true },
        })
      ).map((a) => a.staffId),
    );

    const teachingAssignments = await this.prisma.staffAssignment.findMany({
      where: {
        assignmentType: { in: [AssignmentType.CLASS_TEACHER, AssignmentType.SUBJECT_TEACHER] },
        isActive: true,
        classArm: { classLevel: { category: { in: categories } } },
      },
      select: { staffId: true },
    });
    const teachingStaffIds = new Set(teachingAssignments.map((a) => a.staffId));
    return [...teachingStaffIds].filter((id) => !excludedStaffIds.has(id));
  }

  /**
   * Same guard as ScheduleGenerationRequestService.assertValidWeeklyDutyRequest
   * — a second generate run against an already-rostered term/group is
   * rejected outright rather than silently double-staffing every week.
   * Duplicated rather than shared: that method is private on a different
   * service and the AI path's own request-creation flow.
   */
  private async assertNoExistingRoster(termId: string, classLevelCategoryGroup: ClassLevelCategoryGroup) {
    const term = await this.prisma.term.findUniqueOrThrow({ where: { id: termId } });
    const existing = await this.prisma.dutyAssignment.findFirst({
      where: {
        classLevelCategoryGroup,
        weekStartDate: { gte: term.startDate, lte: term.endDate },
        approvalStatus: { not: TimetableApprovalStatus.REJECTED },
      },
    });
    if (existing) {
      throw new BadRequestException(
        `A duty roster already exists for this term and ${classLevelCategoryGroup} group — reject the existing rows first if you want to regenerate`,
      );
    }
    return term;
  }

  /**
   * Round-robin, not CP-SAT: cycles through the eligible pool
   * `teachersPerWeek` at a time, advancing the cursor by that many staff
   * each week so nobody repeats until the whole pool has had a turn — a
   * plain, deterministic spacing heuristic in place of
   * MIN_WEEKS_BETWEEN_REPEAT_DUTY's soft CP-SAT objective, adequate for a
   * feature whose whole point is to skip the solver.
   */
  async generate(dto: GenerateDutyRosterDto, user: RequestUser) {
    const term = await this.assertNoExistingRoster(dto.termId, dto.classLevelCategoryGroup);

    const eligibleStaffIds = await this.resolveEligibleStaffIds(dto.classLevelCategoryGroup);
    if (eligibleStaffIds.length < dto.teachersPerWeek) {
      throw new BadRequestException(
        `Eligible staff pool (${eligibleStaffIds.length}) for ${dto.classLevelCategoryGroup} is smaller than teachersPerWeek (${dto.teachersPerWeek})`,
      );
    }

    const weeks = this.resolveWeeks(term.startDate, term.endDate);
    const breakDates = new Set(dto.breakWeekStartDates ?? []);

    return this.prisma.$transaction(async (tx) => {
      const request = await tx.scheduleGenerationRequest.create({
        data: {
          scope: ScheduleScope.WEEKLY_DUTY,
          termId: dto.termId,
          classLevelCategoryGroup: dto.classLevelCategoryGroup,
          parameters: { teachersPerWeek: dto.teachersPerWeek, manual: true },
          status: ScheduleGenerationStatus.COMPLETED,
          completedAt: new Date(),
          reviewStatus: TimetableApprovalStatus.PENDING_REVIEW,
          // This request never actually gets dispatched to the queue/
          // callback controller — the column is just NOT NULL, so a random
          // value that satisfies its uniqueness is all it needs to be.
          callbackToken: randomBytes(32).toString("hex"),
          requestedByUserId: user.id,
        },
      });

      let cursor = 0;
      for (const weekStartDate of weeks) {
        // A DutyRosterWeek row for this exact week may already exist —
        // e.g. Admin set a topic on an AI-generated roster (upsertWeek
        // creates one on demand for exactly that), then rejected the
        // roster and is now regenerating. upsert(), not create(): reusing
        // that row keeps its topic, and — since only a truthy
        // breakWeekStartDates entry can *set* isBreak here, never unset it
        // — preserves an existing break flag across a regenerate too,
        // rather than silently un-marking a week someone already flagged.
        const requestedBreak = breakDates.has(weekStartDate.toISOString().slice(0, 10));
        const week = await tx.dutyRosterWeek.upsert({
          where: {
            termId_classLevelCategoryGroup_weekStartDate: {
              termId: dto.termId,
              classLevelCategoryGroup: dto.classLevelCategoryGroup,
              weekStartDate,
            },
          },
          create: {
            termId: dto.termId,
            classLevelCategoryGroup: dto.classLevelCategoryGroup,
            weekStartDate,
            isBreak: requestedBreak,
          },
          update: requestedBreak ? { isBreak: true } : {},
        });
        if (week.isBreak) continue;

        for (let i = 0; i < dto.teachersPerWeek; i++) {
          const staffId = eligibleStaffIds[(cursor + i) % eligibleStaffIds.length]!;
          await tx.dutyAssignment.create({
            data: {
              weekStartDate,
              classLevelCategoryGroup: dto.classLevelCategoryGroup,
              staffId,
              generatedBy: TimetableGeneratedBy.MANUAL,
              approvalStatus: TimetableApprovalStatus.PENDING_REVIEW,
              scheduleGenerationRequestId: request.id,
              dutyRosterWeekId: week.id,
            },
          });
        }
        cursor += dto.teachersPerWeek;
      }

      return tx.dutyRosterWeek.findMany({
        where: { termId: dto.termId, classLevelCategoryGroup: dto.classLevelCategoryGroup },
        orderBy: { weekStartDate: "asc" },
      });
    });
  }

  findAll(termId: string, classLevelCategoryGroup: ClassLevelCategoryGroup) {
    return this.prisma.dutyRosterWeek.findMany({
      where: { termId, classLevelCategoryGroup },
      orderBy: { weekStartDate: "asc" },
    });
  }

  /**
   * A week with no DutyRosterWeek row yet — always an AI (OR-Tools)
   * WEEKLY_DUTY roster, since that path writes DutyAssignment rows
   * directly and never creates one (see the schema comment on
   * DutyAssignment.dutyRosterWeekId). Setting a topic or marking a break is
   * the first thing that ever needs one, so it's created here on first use,
   * identified by natural key rather than an id that doesn't exist yet —
   * one endpoint for every week regardless of which path generated it.
   * Turning a week into a break clears whatever staff it held (any
   * approvalStatus — a break week shows no on-duty teachers regardless of
   * whether they'd been approved yet), matched by weekStartDate/
   * classLevelCategoryGroup rather than dutyRosterWeekId since an
   * AI-generated week's DutyAssignment rows never had that FK set before
   * this call. The reverse (un-marking a break) is deliberately not
   * supported, see the schema comment.
   */
  async upsertWeek(dto: UpsertDutyRosterWeekDto) {
    return this.prisma.$transaction(async (tx) => {
      const week = await tx.dutyRosterWeek.upsert({
        where: {
          termId_classLevelCategoryGroup_weekStartDate: {
            termId: dto.termId,
            classLevelCategoryGroup: dto.classLevelCategoryGroup,
            weekStartDate: dto.weekStartDate,
          },
        },
        create: {
          termId: dto.termId,
          classLevelCategoryGroup: dto.classLevelCategoryGroup,
          weekStartDate: dto.weekStartDate,
          topic: dto.topic,
          isBreak: dto.isBreak ?? false,
        },
        update: {
          ...(dto.topic !== undefined ? { topic: dto.topic } : {}),
          ...(dto.isBreak !== undefined ? { isBreak: dto.isBreak } : {}),
        },
      });
      if (dto.isBreak === true) {
        await tx.dutyAssignment.deleteMany({
          where: { weekStartDate: dto.weekStartDate, classLevelCategoryGroup: dto.classLevelCategoryGroup },
        });
      }
      return week;
    });
  }
}

/**
 * Same actor set as DutyAssignmentController/ScheduleGenerationRequestService.
 * assertCanTrigger's WEEKLY_DUTY branch: Super-Admin/Registrar unscoped,
 * Principal limited to JSS_SSS, Headteacher to CRECHE_NURSERY_PRIMARY, plain
 * Admin excluded (PRD §5 footnote 5).
 */
@Controller("duty-roster-weeks")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class DutyRosterWeekController {
  constructor(private readonly service: DutyRosterWeekService) {}

  @Get()
  findAll(
    @CurrentUser() user: RequestUser,
    @Query("termId") termId: string,
    @Query("classLevelCategoryGroup") classLevelCategoryGroup: ClassLevelCategoryGroup,
  ) {
    this.assertNotStudentOrParent(user);
    if (!termId || !classLevelCategoryGroup) {
      throw new BadRequestException("termId and classLevelCategoryGroup are required");
    }
    return this.service.findAll(termId, classLevelCategoryGroup);
  }

  @Post("generate")
  @Audited("DutyRosterWeek", "dutyRosterWeek")
  generate(@Body() dto: GenerateDutyRosterDto, @CurrentUser() user: RequestUser) {
    this.assertCanTrigger(user, dto.classLevelCategoryGroup);
    return this.service.generate(dto, user);
  }

  // Sets a topic and/or marks a break for a week, creating its
  // DutyRosterWeek row on demand if one doesn't exist yet (an
  // AI-generated roster has none). Same assertCanManage actor set as
  // generate() uses assertCanTrigger for — editing an existing week isn't
  // "generating" a fresh roster, so this is intentionally the broader grant.
  @Post("upsert")
  @Audited("DutyRosterWeek", "dutyRosterWeek")
  upsert(@Body() dto: UpsertDutyRosterWeekDto, @CurrentUser() user: RequestUser) {
    this.assertCanManage(user);
    return this.service.upsertWeek(dto);
  }

  private assertCanTrigger(user: RequestUser, targetGroup: ClassLevelCategoryGroup) {
    if (user.roles.includes("SUPER_ADMIN") || user.assignmentTypes.includes("REGISTRAR")) return;

    const isPrincipal = user.assignmentTypes.includes("PRINCIPAL");
    const isHeadteacher = user.assignmentTypes.includes("HEADTEACHER");
    const allowedGroup = isPrincipal
      ? ClassLevelCategoryGroup.JSS_SSS
      : isHeadteacher
        ? ClassLevelCategoryGroup.CRECHE_NURSERY_PRIMARY
        : null;

    if (!allowedGroup) {
      throw new ForbiddenException("Only Super-Admin, Registrar, or a staff member holding an active Principal/Headteacher assignment can generate a duty roster");
    }
    if (targetGroup !== allowedGroup) {
      throw new ForbiddenException(`This assignment is not scoped to ${targetGroup} class arms`);
    }
  }

  // Editing topics/break status is broader than triggering generation —
  // same assertCanManage actor set as DutyAssignmentController (adds plain
  // Admin, who can edit an existing draft but not trigger a fresh one).
  private assertCanManage(user: RequestUser) {
    const isAdmin = user.roles.includes("ADMIN") || user.roles.includes("SUPER_ADMIN");
    const canManage =
      isAdmin ||
      user.assignmentTypes.includes("REGISTRAR") ||
      ["PRINCIPAL", "HEADTEACHER"].some((t) => user.assignmentTypes.includes(t));
    if (!canManage) {
      throw new ForbiddenException("Insufficient permissions to manage the duty roster");
    }
  }

  private assertNotStudentOrParent(user: RequestUser) {
    const isStaffOrAdmin =
      user.roles.includes("STAFF") || user.roles.includes("ADMIN") || user.roles.includes("SUPER_ADMIN");
    if (!isStaffOrAdmin) {
      throw new ForbiddenException("Weekly duty rosters are not visible to this account type");
    }
  }
}
