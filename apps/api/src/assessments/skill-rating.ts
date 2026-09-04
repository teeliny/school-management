import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Post, Query, UseGuards } from "@nestjs/common";
import { AssignmentType, ClassLevelCategory, ReportWindowStatus, SkillGroupValueType } from "@prisma/client";
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
   * A group restricted to specific ClassLevelCategorys (e.g. Reception's
   * "Numbers"/"Letters"/"Social & Character Skills") can't be rated for a
   * student outside them — no restriction rows at all means it applies
   * everywhere (e.g. "Psychomotor Skills"), same "absence means
   * active/applicable" sparse-override reasoning used throughout this
   * codebase (ClassSubjectLevelStatus, ClassSubjectTermStatus).
   */
  private assertApplicable(
    item: { name: string; group: { classLevelCategories: { classLevelCategory: ClassLevelCategory }[] } },
    studentCategory: ClassLevelCategory,
  ): void {
    if (item.group.classLevelCategories.length === 0) return;
    if (!item.group.classLevelCategories.some((c) => c.classLevelCategory === studentCategory)) {
      throw new BadRequestException(`"${item.name}" does not apply to this student's class level`);
    }
  }

  /** Exactly one of rating/rangeText, dictated by the item's group's valueType. */
  private assertValueMatchesType(valueType: SkillGroupValueType, dto: CreateSkillRatingDto): void {
    if (valueType === SkillGroupValueType.RATING) {
      if (!dto.rating) throw new BadRequestException("rating is required for this skill item");
      if (dto.rangeText) throw new BadRequestException("rangeText is only valid for a range-text skill item");
    } else {
      if (!dto.rangeText?.trim()) throw new BadRequestException("rangeText is required for this skill item");
      if (dto.rating) throw new BadRequestException("rating is only valid for a rating-type skill item");
    }
  }

  /**
   * PRD §3.6: only the CLASS_TEACHER of the student's class may rate, and
   * only while the term+classLevel's ReportWindow is OPEN — or Admin/Super-
   * Admin, any time, as override (isOverride resolved by the controller from
   * the caller's CASL ability, same shape as ScoreEntryService.enter).
   */
  async rate(dto: CreateSkillRatingDto, user: RequestUser, isOverride: boolean) {
    const student = await this.prisma.studentProfile.findUniqueOrThrow({
      where: { id: dto.studentId },
      include: { currentClass: { include: { classLevel: true } } },
    });
    if (!student.currentClass) {
      throw new BadRequestException("Student has no current class — cannot rate skills");
    }

    let ratedByStaffId: string | null = null;

    if (isOverride) {
      const staffProfile = await this.prisma.staffProfile.findUnique({ where: { userId: user.id } });
      ratedByStaffId = staffProfile?.id ?? null;
    } else {
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

    // Applies regardless of override, same "hard block, not just a
    // permission gate" reasoning as ClassSubjectTermStatus/
    // ClassSubjectLevelStatus's checks in ScoreEntryService.
    const item = await this.prisma.skillAssessmentItem.findUniqueOrThrow({
      where: { id: dto.skillAssessmentItemId },
      include: { group: { include: { classLevelCategories: true } } },
    });
    this.assertApplicable(item, student.currentClass.classLevel.category);
    this.assertValueMatchesType(item.group.valueType, dto);

    const rating = item.group.valueType === SkillGroupValueType.RATING ? dto.rating : null;
    const rangeText = item.group.valueType === SkillGroupValueType.RANGE_TEXT ? dto.rangeText : null;

    return this.prisma.skillRating.upsert({
      where: {
        studentId_termId_skillAssessmentItemId: {
          studentId: dto.studentId,
          termId: dto.termId,
          skillAssessmentItemId: dto.skillAssessmentItemId,
        },
      },
      create: { studentId: dto.studentId, termId: dto.termId, skillAssessmentItemId: dto.skillAssessmentItemId, rating, rangeText, ratedByStaffId },
      update: { rating, rangeText, ratedByStaffId },
    });
  }

  findAll(filters: { studentId?: string; termId?: string }) {
    return this.prisma.skillRating.findMany({ where: filters });
  }

  /**
   * Powers the "X of Y fully rated" indicator for a class arm — a student
   * only counts as "completed" once every active SkillAssessmentItem
   * applicable to this class arm's category has a rating for this term, not
   * every item in the session regardless of category (a class-level-
   * restricted item like Reception's "Counting" would otherwise make it
   * impossible for a JSS class to ever reach 100%, and vice versa).
   */
  async progress(filters: { classArmId: string; termId: string; academicSessionId: string }) {
    const classArm = await this.prisma.classArm.findUniqueOrThrow({
      where: { id: filters.classArmId },
      include: { classLevel: true },
    });
    const applicableToCategory = {
      group: {
        OR: [
          { classLevelCategories: { none: {} } },
          { classLevelCategories: { some: { classLevelCategory: classArm.classLevel.category } } },
        ],
      },
    };

    const [totalStudents, activeItemCount, ratingCounts] = await Promise.all([
      this.prisma.studentProfile.count({ where: { currentClassId: filters.classArmId } }),
      this.prisma.skillAssessmentItem.count({
        where: { academicSessionId: filters.academicSessionId, isActive: true, ...applicableToCategory },
      }),
      this.prisma.skillRating.groupBy({
        by: ["studentId"],
        where: {
          termId: filters.termId,
          student: { currentClassId: filters.classArmId },
          skillAssessmentItem: { academicSessionId: filters.academicSessionId, isActive: true, ...applicableToCategory },
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
