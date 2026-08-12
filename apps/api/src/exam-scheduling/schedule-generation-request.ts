import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { randomBytes } from "node:crypto";
import {
  AssessmentComponentType,
  ClassLevelCategoryGroup,
  ScheduleGenerationStatus,
  ScheduleScope,
  TimetableApprovalStatus,
} from "@prisma/client";
import { categoryToGroup, QUEUE_NAMES, type SchedulingSolveDispatchJob } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { AbilityFactory } from "../casl/ability.factory";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { CreateScheduleGenerationRequestDto } from "./dto/schedule-generation-request.dto";

@Injectable()
export class ScheduleGenerationRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly abilityFactory: AbilityFactory,
    @InjectQueue(QUEUE_NAMES.SCHEDULING_SOLVE_DISPATCH)
    private readonly dispatchQueue: Queue<SchedulingSolveDispatchJob>,
  ) {}

  /**
   * PRD §5 footnote 5: triggering generation is gated by
   * StaffAssignment.assignmentType, not Role alone — Super-Admin/Registrar
   * are unscoped, an Admin holding PRINCIPAL may only target JSS/SSS,
   * HEADTEACHER only CRECHE/NURSERY/PRIMARY, and an Admin holding neither
   * cannot trigger at all. The target's class-level-category group is
   * resolved from whichever scoping field the request supplies; a request
   * with no scoping field at all (a whole-school run) is allowed through for
   * Super-Admin/Registrar only — a Principal/Headteacher run must always
   * name its own group (via classArmId/assessmentComponentId/
   * classLevelCategoryGroup) so this check has something to compare against.
   */
  private async resolveTargetGroup(dto: CreateScheduleGenerationRequestDto): Promise<ClassLevelCategoryGroup | null> {
    if (dto.classLevelCategoryGroup) return dto.classLevelCategoryGroup;

    if (dto.classArmId) {
      const classArm = await this.prisma.classArm.findUniqueOrThrow({
        where: { id: dto.classArmId },
        include: { classLevel: true },
      });
      return categoryToGroup(classArm.classLevel.category);
    }

    if (dto.assessmentComponentId) {
      const component = await this.prisma.assessmentComponent.findUniqueOrThrow({
        where: { id: dto.assessmentComponentId },
      });
      return categoryToGroup(component.classLevelCategory);
    }

    return null;
  }

  private async assertCanTrigger(user: RequestUser, dto: CreateScheduleGenerationRequestDto) {
    const ability = this.abilityFactory.createForUser(user);
    if (!ability.can("manage", "ScheduleGenerationRequest")) {
      throw new ForbiddenException(
        "Only Super-Admin, Registrar, or a staff member holding an active Principal/Headteacher assignment can trigger schedule generation",
      );
    }

    // Super-Admin/Registrar are unscoped — nothing further to check.
    if (user.roles.includes("SUPER_ADMIN") || user.assignmentTypes.includes("REGISTRAR")) return;

    const targetGroup = await this.resolveTargetGroup(dto);
    const isPrincipal = user.assignmentTypes.includes("PRINCIPAL");
    const isHeadteacher = user.assignmentTypes.includes("HEADTEACHER");
    const allowedGroup = isPrincipal
      ? ClassLevelCategoryGroup.JSS_SSS
      : isHeadteacher
        ? ClassLevelCategoryGroup.CRECHE_NURSERY_PRIMARY
        : null;

    if (!allowedGroup) {
      throw new ForbiddenException("An Admin without an active Principal/Headteacher assignment cannot trigger schedule generation");
    }
    if (!targetGroup) {
      throw new BadRequestException(
        "A Principal/Headteacher-triggered request must specify classArmId, assessmentComponentId, or classLevelCategoryGroup so it can be scoped",
      );
    }
    if (targetGroup !== allowedGroup) {
      throw new ForbiddenException(`This assignment is not scoped to ${targetGroup} class arms`);
    }
  }

  /**
   * BUILD_PLAN.md §9 Step 3: assessmentComponentId must resolve to an EXAM
   * or MID_TERM component (CA has no exam to schedule), and the
   * exam-writing date range — which isn't stored anywhere else (PRD's
   * inputOpensAt/inputClosesAt are score-entry windows, not exam-sitting
   * dates) — comes from parameters.examStartDate/examEndDate, validated to
   * fall within that component's own Term.
   */
  private async assertValidExamTimetableRequest(dto: CreateScheduleGenerationRequestDto) {
    if (!dto.assessmentComponentId) {
      throw new BadRequestException("assessmentComponentId is required for EXAM_TIMETABLE scope");
    }
    const component = await this.prisma.assessmentComponent.findUniqueOrThrow({
      where: { id: dto.assessmentComponentId },
      include: { term: true },
    });
    if (component.type !== AssessmentComponentType.EXAM && component.type !== AssessmentComponentType.MID_TERM) {
      throw new BadRequestException("assessmentComponentId must resolve to an EXAM or MID_TERM component");
    }

    const parameters = (dto.parameters ?? {}) as Record<string, unknown>;
    const examStartDate = typeof parameters.examStartDate === "string" ? new Date(parameters.examStartDate) : null;
    const examEndDate = typeof parameters.examEndDate === "string" ? new Date(parameters.examEndDate) : null;
    if (!examStartDate || !examEndDate || Number.isNaN(examStartDate.getTime()) || Number.isNaN(examEndDate.getTime())) {
      throw new BadRequestException("parameters.examStartDate and parameters.examEndDate (YYYY-MM-DD) are required for EXAM_TIMETABLE scope");
    }
    if (examStartDate > examEndDate) {
      throw new BadRequestException("parameters.examStartDate must be on or before examEndDate");
    }
    if (examStartDate < component.term.startDate || examEndDate > component.term.endDate) {
      throw new BadRequestException("The exam period must fall within the assessment component's term");
    }
  }

  /**
   * BUILD_PLAN.md §9 Step 5: resolves the target ClassLevelCategoryGroup(s)
   * for a WEEKLY_DUTY request — dto.classLevelCategoryGroup if set (always
   * true for a Principal/Headteacher trigger, enforced by assertCanTrigger),
   * otherwise both groups (a Super-Admin/Registrar combined run, FR6.11).
   */
  private resolveWeeklyDutyTargetGroups(dto: CreateScheduleGenerationRequestDto): ClassLevelCategoryGroup[] {
    return dto.classLevelCategoryGroup
      ? [dto.classLevelCategoryGroup]
      : [ClassLevelCategoryGroup.JSS_SSS, ClassLevelCategoryGroup.CRECHE_NURSERY_PRIMARY];
  }

  /**
   * BUILD_PLAN.md §9 Step 5: termId's Term must exist (required earlier in
   * create()); every target group is checked for a pre-existing, non-
   * REJECTED DutyAssignment row already covering one of that term's weeks —
   * DutyAssignment has no per-row conflict check the way TimetableSlot/
   * ExamSchedule/InvigilationAssignment do (no overlap concept, just whole
   * weeks), so a second run against an already-rostered term/group is
   * rejected outright here instead, rather than silently double-staffing
   * every week. parameters.teachersPerWeek, if supplied, must be a positive
   * integer (falls back to the seeded TEACHERS_PER_WEEK default otherwise).
   */
  private async assertValidWeeklyDutyRequest(dto: CreateScheduleGenerationRequestDto) {
    if (!dto.termId) {
      throw new BadRequestException("termId is required for WEEKLY_DUTY scope");
    }
    const term = await this.prisma.term.findUniqueOrThrow({ where: { id: dto.termId } });

    const targetGroups = this.resolveWeeklyDutyTargetGroups(dto);
    const existing = await this.prisma.dutyAssignment.findFirst({
      where: {
        classLevelCategoryGroup: { in: targetGroups },
        weekStartDate: { gte: term.startDate, lte: term.endDate },
        approvalStatus: { not: TimetableApprovalStatus.REJECTED },
      },
    });
    if (existing) {
      throw new BadRequestException(
        `A duty roster already exists for this term and ${existing.classLevelCategoryGroup} group — reject the existing rows first if you want to regenerate`,
      );
    }

    const parameters = (dto.parameters ?? {}) as Record<string, unknown>;
    if (
      parameters.teachersPerWeek !== undefined &&
      (typeof parameters.teachersPerWeek !== "number" ||
        !Number.isInteger(parameters.teachersPerWeek) ||
        parameters.teachersPerWeek < 1)
    ) {
      throw new BadRequestException("parameters.teachersPerWeek must be a positive integer");
    }
  }

  /**
   * BUILD_PLAN.md §9 Step 4: assessmentComponentId must resolve to an EXAM
   * or MID_TERM component (same reuse of EXAM_TIMETABLE's FK, confirmed by
   * PRD §3.8), and — per the approval-order decision made for this step —
   * every ExamSchedule row in scope (narrowed by classArmId if set) must
   * already be Admin-approved, so InvigilationAssignment rows are never
   * generated against a still-editable draft.
   */
  private async assertValidInvigilationRequest(dto: CreateScheduleGenerationRequestDto) {
    if (!dto.assessmentComponentId) {
      throw new BadRequestException("assessmentComponentId is required for INVIGILATION scope");
    }
    const component = await this.prisma.assessmentComponent.findUniqueOrThrow({
      where: { id: dto.assessmentComponentId },
    });
    if (component.type !== AssessmentComponentType.EXAM && component.type !== AssessmentComponentType.MID_TERM) {
      throw new BadRequestException("assessmentComponentId must resolve to an EXAM or MID_TERM component");
    }

    const examSchedules = await this.prisma.examSchedule.findMany({
      where: { assessmentComponentId: dto.assessmentComponentId, classArmId: dto.classArmId },
      select: { approvalStatus: true },
    });
    if (examSchedules.length === 0) {
      throw new BadRequestException("No exam schedules exist yet for this assessment component — generate the exam timetable first");
    }
    if (examSchedules.some((es) => es.approvalStatus !== TimetableApprovalStatus.APPROVED)) {
      throw new BadRequestException("All exam schedules for this assessment component must be approved before generating invigilation");
    }
  }

  async create(dto: CreateScheduleGenerationRequestDto, user: RequestUser) {
    // BUILD_PLAN.md §9 Step 2: TimetableSlot is already term-scoped (matching
    // manual CRUD), so a CLASS_TIMETABLE run generates exactly one term's
    // slots per solve — same granularity a human editing the timetable
    // manually already works at. termId stays a nullable column since
    // WEEKLY_DUTY also uses it, so this is a scope-specific service check,
    // not a schema-level requirement.
    if (dto.scope === "CLASS_TIMETABLE" && !dto.termId) {
      throw new BadRequestException("termId is required for CLASS_TIMETABLE scope");
    }
    if (dto.scope === "EXAM_TIMETABLE") {
      await this.assertValidExamTimetableRequest(dto);
    }
    if (dto.scope === "INVIGILATION") {
      await this.assertValidInvigilationRequest(dto);
    }
    if (dto.scope === "WEEKLY_DUTY") {
      await this.assertValidWeeklyDutyRequest(dto);
    }

    await this.assertCanTrigger(user, dto);

    const request = await this.prisma.scheduleGenerationRequest.create({
      data: {
        scope: dto.scope,
        classArmId: dto.classArmId,
        assessmentComponentId: dto.assessmentComponentId,
        termId: dto.termId,
        classLevelCategoryGroup: dto.classLevelCategoryGroup,
        parameters: dto.parameters,
        callbackToken: randomBytes(32).toString("hex"),
        requestedByUserId: user.id,
      },
    });

    await this.dispatchQueue.add("dispatch", { requestId: request.id });
    return request;
  }

  findAll(filters: { scope?: ScheduleScope; status?: ScheduleGenerationStatus }) {
    return this.prisma.scheduleGenerationRequest.findMany({
      where: filters,
      orderBy: { requestedAt: "desc" },
    });
  }

  findOne(id: string) {
    return this.prisma.scheduleGenerationRequest.findUniqueOrThrow({ where: { id } });
  }
}

@Controller("schedule-generation-requests")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class ScheduleGenerationRequestController {
  constructor(private readonly service: ScheduleGenerationRequestService) {}

  @Post()
  create(@Body() dto: CreateScheduleGenerationRequestDto, @CurrentUser() user: RequestUser) {
    return this.service.create(dto, user);
  }

  @Get()
  findAll(@Query("scope") scope?: ScheduleScope, @Query("status") status?: ScheduleGenerationStatus) {
    return this.service.findAll({ scope, status });
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }
}
