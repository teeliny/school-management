import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Post, Query, UseGuards } from "@nestjs/common";
import { AssignmentType, ReportWindowStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { AbilityFactory } from "../casl/ability.factory";
import { StaffAssignmentService } from "../staff-assignments/staff-assignment";
import { CreateSkillRatingDto } from "./dto/skill-rating.dto";

@Injectable()
export class SkillRatingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly staffAssignments: StaffAssignmentService,
  ) {}

  /**
   * PRD §3.6: only the CLASS_TEACHER of the student's class may rate, and
   * only while the term+classLevel's ReportWindow is OPEN — or Admin/Super-
   * Admin, any time, as override (isOverride resolved by the controller from
   * the caller's CASL ability, same shape as ScoreEntryService.enter).
   */
  async rate(dto: CreateSkillRatingDto, user: RequestUser, isOverride: boolean) {
    let ratedByStaffId: string | null = null;

    if (isOverride) {
      const staffProfile = await this.prisma.staffProfile.findUnique({ where: { userId: user.id } });
      ratedByStaffId = staffProfile?.id ?? null;
    } else {
      const student = await this.prisma.studentProfile.findUniqueOrThrow({
        where: { id: dto.studentId },
        include: { currentClass: { include: { classLevel: true } } },
      });
      if (!student.currentClass) {
        throw new BadRequestException("Student has no current class — cannot rate skills");
      }

      const assignment = await this.staffAssignments.findActiveAssignment({
        userId: user.id,
        assignmentType: AssignmentType.CLASS_TEACHER,
        classArmId: student.currentClass.id,
      });
      if (!assignment) {
        throw new ForbiddenException("You are not the class teacher for this student");
      }
      ratedByStaffId = assignment.staffId;

      const reportWindow = await this.prisma.reportWindow.findFirst({
        where: { termId: dto.termId, classLevelCategory: student.currentClass.classLevel.category },
      });
      if (!reportWindow || reportWindow.status !== ReportWindowStatus.OPEN) {
        throw new BadRequestException("The report window is not open for skill ratings");
      }
    }

    return this.prisma.skillRating.upsert({
      where: {
        studentId_termId_skillAssessmentItemId: {
          studentId: dto.studentId,
          termId: dto.termId,
          skillAssessmentItemId: dto.skillAssessmentItemId,
        },
      },
      create: { ...dto, ratedByStaffId },
      update: { rating: dto.rating, ratedByStaffId },
    });
  }

  findAll(filters: { studentId?: string; termId?: string }) {
    return this.prisma.skillRating.findMany({ where: filters });
  }

  // Powers the "X of Y fully rated" indicator for a class arm — a student
  // only counts as "completed" once every active SkillAssessmentItem for the
  // session has a rating for this term, not just one.
  async progress(filters: { classArmId: string; termId: string; academicSessionId: string }) {
    const [totalStudents, activeItemCount, ratingCounts] = await Promise.all([
      this.prisma.studentProfile.count({ where: { currentClassId: filters.classArmId } }),
      this.prisma.skillAssessmentItem.count({
        where: { academicSessionId: filters.academicSessionId, isActive: true },
      }),
      this.prisma.skillRating.groupBy({
        by: ["studentId"],
        where: {
          termId: filters.termId,
          student: { currentClassId: filters.classArmId },
          skillAssessmentItem: { academicSessionId: filters.academicSessionId, isActive: true },
        },
        _count: { _all: true },
      }),
    ]);

    const completedCount =
      activeItemCount > 0 ? ratingCounts.filter((r) => r._count._all >= activeItemCount).length : 0;
    return { totalStudents, completedCount };
  }
}

@Controller("skill-ratings")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class SkillRatingController {
  constructor(
    private readonly service: SkillRatingService,
    private readonly abilityFactory: AbilityFactory,
  ) {}

  @Post()
  rate(@Body() dto: CreateSkillRatingDto, @CurrentUser() user: RequestUser) {
    const ability = this.abilityFactory.createForUser(user);
    const isOverride = ability.can("manage", "SkillRating");
    return this.service.rate(dto, user, isOverride);
  }

  @Get()
  findAll(@Query("studentId") studentId?: string, @Query("termId") termId?: string) {
    return this.service.findAll({ studentId, termId });
  }

  @Get("progress")
  progress(
    @Query("classArmId") classArmId: string,
    @Query("termId") termId: string,
    @Query("academicSessionId") academicSessionId: string,
  ) {
    return this.service.progress({ classArmId, termId, academicSessionId });
  }
}
