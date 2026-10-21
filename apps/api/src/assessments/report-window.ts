import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AssignmentType, ClassLevelCategory, ReportWindowStatus } from "@prisma/client";
import { AbilityFactory } from "../casl/ability.factory";
import { StaffAssignmentService } from "../staff-assignments/staff-assignment";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { Audited } from "../audit/audited.decorator";
import { CreateReportWindowDto, EnsureReportWindowDto, UpdateReportWindowDto } from "./dto/report-window.dto";

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ReportWindowService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateReportWindowDto, userId: string) {
    return this.prisma.reportWindow.create({ data: { ...dto, createdByUserId: userId } });
  }

  update(id: string, dto: UpdateReportWindowDto) {
    return this.prisma.reportWindow.update({ where: { id }, data: dto });
  }

  findAll(filters: { termId?: string; classLevelCategory?: ClassLevelCategory }) {
    return this.prisma.reportWindow.findMany({ where: filters });
  }

  findOne(id: string) {
    return this.prisma.reportWindow.findUniqueOrThrow({ where: { id } });
  }

  remove(id: string) {
    return this.prisma.reportWindow.delete({ where: { id } });
  }

  /**
   * Returns the report window for this term + class group, creating it
   * first when none exists, so class teachers aren't blocked waiting for an
   * Admin to configure one. The new window is OPEN from now until the term's
   * end date, or for 14 days if the term has already ended, so the sweep
   * doesn't close it immediately. Admins can still edit, force-close or
   * delete it like any other window. An existing window, whatever its
   * status, is returned untouched.
   */
  async ensure(termId: string, classLevelCategory: ClassLevelCategory, userId: string) {
    const existing = await this.prisma.reportWindow.findUnique({
      where: { termId_classLevelCategory: { termId, classLevelCategory } },
    });
    if (existing) return existing;

    const term = await this.prisma.term.findUniqueOrThrow({ where: { id: termId } });
    const now = new Date();
    const inputClosesAt = term.endDate > now ? term.endDate : new Date(now.getTime() + 14 * DAY_MS);
    // upsert rather than create: two class teachers in the same class group
    // opening the panel at once must not trip the (termId, classLevelCategory)
    // unique index.
    return this.prisma.reportWindow.upsert({
      where: { termId_classLevelCategory: { termId, classLevelCategory } },
      create: {
        termId,
        classLevelCategory,
        inputOpensAt: now,
        inputClosesAt,
        status: ReportWindowStatus.OPEN,
        createdByUserId: userId,
      },
      update: {},
    });
  }

  forceOpen(id: string) {
    return this.prisma.reportWindow.update({ where: { id }, data: { status: ReportWindowStatus.OPEN } });
  }

  forceClose(id: string) {
    return this.prisma.reportWindow.update({ where: { id }, data: { status: ReportWindowStatus.CLOSED } });
  }
}

@Controller("report-windows")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class ReportWindowController {
  constructor(
    private readonly service: ReportWindowService,
    private readonly prisma: PrismaService,
    private readonly staffAssignments: StaffAssignmentService,
    private readonly abilityFactory: AbilityFactory,
  ) {}

  // Called by the class-teacher Skills & Comments panel when no window
  // exists yet. Allowed for that class arm's class teacher, or anyone who
  // can manage report windows.
  @Post("ensure")
  @Audited("ReportWindow")
  async ensure(@Body() dto: EnsureReportWindowDto, @CurrentUser() user: RequestUser) {
    const arm = await this.prisma.classArm.findUniqueOrThrow({
      where: { id: dto.classArmId },
      include: { classLevel: true },
    });
    if (!this.abilityFactory.createForUser(user).can("manage", "ReportWindow")) {
      const assignment = await this.staffAssignments.findActiveAssignment({
        userId: user.id,
        assignmentType: AssignmentType.CLASS_TEACHER,
        classArmId: arm.id,
      });
      if (!assignment) throw new ForbiddenException("You are not the class teacher for this class");
    }
    return this.service.ensure(dto.termId, arm.classLevel.category, user.id);
  }

  @Post()
  @CheckPolicies((ability) => ability.can("manage", "ReportWindow"))
  @Audited("ReportWindow")
  create(@Body() dto: CreateReportWindowDto, @CurrentUser() user: RequestUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  findAll(@Query("termId") termId?: string, @Query("classLevelCategory") classLevelCategory?: ClassLevelCategory) {
    return this.service.findAll({ termId, classLevelCategory });
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Patch(":id")
  @CheckPolicies((ability) => ability.can("manage", "ReportWindow"))
  @Audited("ReportWindow", "reportWindow")
  update(@Param("id") id: string, @Body() dto: UpdateReportWindowDto) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @CheckPolicies((ability) => ability.can("manage", "ReportWindow"))
  @Audited("ReportWindow", "reportWindow")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }

  @Patch(":id/force-open")
  @CheckPolicies((ability) => ability.can("manage", "ReportWindow"))
  @Audited("ReportWindow", "reportWindow")
  forceOpen(@Param("id") id: string) {
    return this.service.forceOpen(id);
  }

  @Patch(":id/force-close")
  @CheckPolicies((ability) => ability.can("manage", "ReportWindow"))
  @Audited("ReportWindow", "reportWindow")
  forceClose(@Param("id") id: string) {
    return this.service.forceClose(id);
  }
}
