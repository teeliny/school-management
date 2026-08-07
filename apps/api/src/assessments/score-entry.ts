import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Post, Query, UseGuards } from "@nestjs/common";
import { AssessmentComponentStatus, AssignmentType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { AbilityFactory } from "../casl/ability.factory";
import { StaffAssignmentService } from "../staff-assignments/staff-assignment";
import { ClassSubjectTermStatusService } from "../subjects/class-subject-term-status";
import { CreateScoreEntryDto } from "./dto/score-entry.dto";

@Injectable()
export class ScoreEntryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly staffAssignments: StaffAssignmentService,
    private readonly classSubjectTermStatus: ClassSubjectTermStatusService,
  ) {}

  /**
   * PRD §3.6/FR4.2: only the SUBJECT_TEACHER assigned to this exact
   * subject+classArm, and only while the component is OPEN — or Admin/
   * Super-Admin, any time, as override. `enteredByStaffId` is left null for
   * an override entered by someone with no StaffProfile.
   */
  async enter(dto: CreateScoreEntryDto, user: RequestUser, isOverride: boolean) {
    let enteredByStaffId: string | null = null;

    const classArm = await this.prisma.classArm.findUniqueOrThrow({
      where: { id: dto.classArmId },
      include: { classLevel: true },
    });
    const component = await this.prisma.assessmentComponent.findUniqueOrThrow({
      where: { id: dto.assessmentComponentId },
    });
    const subject = await this.prisma.subject.findUniqueOrThrow({ where: { id: dto.subjectId } });

    // Applies regardless of override: a group subject (e.g. Basic Science and
    // Technology) is never scored directly — only its child subjects are.
    // The group's own SubjectTermResult is a weighted average of its
    // children (SubjectGroupWeight), computed by the worker at report time.
    if (subject.isGroup) {
      throw new BadRequestException(
        "Cannot enter a score directly against a group subject — enter scores against its child subjects instead",
      );
    }

    // component.maxScore is per-component, not a fixed value, so the upper
    // bound can't be a static @Max() on the DTO — it's checked here once the
    // component is loaded. @Min(0) on the DTO already covers the lower bound.
    if (dto.score > Number(component.maxScore)) {
      throw new BadRequestException(`Score cannot exceed this component's max score of ${component.maxScore}`);
    }

    // Applies regardless of override: an explicit per-term disable means the
    // subject doesn't apply to this class this term at all, not just "component
    // isn't open yet" — Admin re-enables it to unblock scoring again.
    await this.classSubjectTermStatus.assertActiveForTerm({
      subjectId: dto.subjectId,
      classLevelCategory: classArm.classLevel.category,
      termId: component.termId,
    });

    if (isOverride) {
      const staffProfile = await this.prisma.staffProfile.findUnique({ where: { userId: user.id } });
      enteredByStaffId = staffProfile?.id ?? null;
    } else {
      const assignment = await this.staffAssignments.findActiveAssignment({
        userId: user.id,
        assignmentType: AssignmentType.SUBJECT_TEACHER,
        subjectId: dto.subjectId,
        classArmId: dto.classArmId,
      });
      if (!assignment) {
        throw new ForbiddenException("You are not the assigned subject teacher for this subject/class");
      }
      enteredByStaffId = assignment.staffId;

      if (component.status !== AssessmentComponentStatus.OPEN) {
        throw new BadRequestException("This assessment component is not open for score entry");
      }
    }

    return this.prisma.scoreEntry.upsert({
      where: {
        studentId_subjectId_assessmentComponentId: {
          studentId: dto.studentId,
          subjectId: dto.subjectId,
          assessmentComponentId: dto.assessmentComponentId,
        },
      },
      create: { ...dto, enteredByStaffId },
      update: { score: dto.score, classArmId: dto.classArmId, enteredByStaffId },
    });
  }

  findAll(filters: { subjectId?: string; assessmentComponentId?: string; classArmId?: string; studentId?: string }) {
    return this.prisma.scoreEntry.findMany({
      where: filters,
      orderBy: { enteredAt: "desc" },
    });
  }

  // Powers the "X of Y students scored" indicator on the gradebook — total
  // roster size for the class arm vs. how many of them have a ScoreEntry for
  // this exact subject+component, independent of any search filter applied
  // to the visible (paginated) student list.
  async summary(filters: { classArmId: string; subjectId: string; assessmentComponentId: string }) {
    const [totalStudents, enteredCount] = await Promise.all([
      this.prisma.studentProfile.count({ where: { currentClassId: filters.classArmId } }),
      this.prisma.scoreEntry.count({ where: filters }),
    ]);
    return { totalStudents, enteredCount };
  }
}

@Controller("score-entries")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class ScoreEntryController {
  constructor(
    private readonly service: ScoreEntryService,
    private readonly abilityFactory: AbilityFactory,
  ) {}

  @Post()
  enter(@Body() dto: CreateScoreEntryDto, @CurrentUser() user: RequestUser) {
    const ability = this.abilityFactory.createForUser(user);
    const isOverride = ability.can("manage", "ScoreEntry");
    return this.service.enter(dto, user, isOverride);
  }

  @Get()
  findAll(
    @Query("subjectId") subjectId?: string,
    @Query("assessmentComponentId") assessmentComponentId?: string,
    @Query("classArmId") classArmId?: string,
    @Query("studentId") studentId?: string,
  ) {
    return this.service.findAll({ subjectId, assessmentComponentId, classArmId, studentId });
  }

  @Get("summary")
  summary(
    @Query("classArmId") classArmId: string,
    @Query("subjectId") subjectId: string,
    @Query("assessmentComponentId") assessmentComponentId: string,
  ) {
    return this.service.summary({ classArmId, subjectId, assessmentComponentId });
  }
}
