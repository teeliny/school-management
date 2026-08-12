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
import { ClassLevelCategoryGroup, ScheduleGenerationStatus, ScheduleScope } from "@prisma/client";
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
