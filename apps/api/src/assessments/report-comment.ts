import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Post, Query, UseGuards } from "@nestjs/common";
import { AssessmentComponentStatus, AssignmentType, ReportCommentType, ReportWindowStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { AbilityFactory } from "../casl/ability.factory";
import { StaffAssignmentService } from "../staff-assignments/staff-assignment";
import { CreateReportCommentDto } from "./dto/report-comment.dto";

@Injectable()
export class ReportCommentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly staffAssignments: StaffAssignmentService,
  ) {}

  private assertSubjectIdConsistency(commentType: ReportCommentType, subjectId?: string) {
    if (commentType === ReportCommentType.SUBJECT && !subjectId) {
      throw new BadRequestException("subjectId is required for a SUBJECT comment");
    }
    if (commentType !== ReportCommentType.SUBJECT && subjectId) {
      throw new BadRequestException("subjectId is only valid for a SUBJECT comment");
    }
  }

  /**
   * PRD §3.6: only the assigned staff for the relevant scope may write —
   * SUBJECT (the subject teacher, gated on the term+classLevel's
   * AssessmentComponents all being CLOSED/PUBLISHED — the same "scoring is
   * effectively done" point SubjectTermResultService aggregates on, not a
   * ReportWindow), CLASS_TEACHER (the class teacher, gated on ReportWindow
   * being OPEN), PRINCIPAL (role-scoped only, no date gate; covers either a
   * PRINCIPAL or HEADTEACHER StaffAssignment, per the schema's
   * ReportCommentType comment) — or Admin/Super-Admin, any time, as
   * override.
   */
  async write(dto: CreateReportCommentDto, user: RequestUser, isOverride: boolean) {
    this.assertSubjectIdConsistency(dto.commentType, dto.subjectId);

    let authorStaffId: string | null = null;

    if (isOverride) {
      const staffProfile = await this.prisma.staffProfile.findUnique({ where: { userId: user.id } });
      authorStaffId = staffProfile?.id ?? null;
    } else if (dto.commentType === ReportCommentType.SUBJECT) {
      const student = await this.prisma.studentProfile.findUniqueOrThrow({
        where: { id: dto.studentId },
        include: { currentClass: true },
      });
      if (!student.currentClass) {
        throw new BadRequestException("Student has no current class — cannot write a subject comment");
      }

      const assignment = await this.staffAssignments.findActiveAssignment({
        userId: user.id,
        assignmentType: AssignmentType.SUBJECT_TEACHER,
        subjectId: dto.subjectId,
        classArmId: student.currentClass.id,
      });
      if (!assignment) {
        throw new ForbiddenException("You are not the assigned subject teacher for this student's subject");
      }
      authorStaffId = assignment.staffId;

      const components = await this.prisma.assessmentComponent.findMany({
        where: { termId: dto.termId, classLevelId: student.currentClass.classLevelId },
      });
      const allClosedOrPublished =
        components.length > 0 &&
        components.every(
          (c) => c.status === AssessmentComponentStatus.CLOSED || c.status === AssessmentComponentStatus.PUBLISHED,
        );
      if (!allClosedOrPublished) {
        throw new BadRequestException(
          "Subject comments open once every assessment component for this term/class level has closed",
        );
      }
    } else if (dto.commentType === ReportCommentType.CLASS_TEACHER) {
      const student = await this.prisma.studentProfile.findUniqueOrThrow({
        where: { id: dto.studentId },
        include: { currentClass: true },
      });
      if (!student.currentClass) {
        throw new BadRequestException("Student has no current class — cannot write a class-teacher comment");
      }

      const assignment = await this.staffAssignments.findActiveAssignment({
        userId: user.id,
        assignmentType: AssignmentType.CLASS_TEACHER,
        classArmId: student.currentClass.id,
      });
      if (!assignment) {
        throw new ForbiddenException("You are not the class teacher for this student");
      }
      authorStaffId = assignment.staffId;

      const reportWindow = await this.prisma.reportWindow.findFirst({
        where: { termId: dto.termId, classLevelId: student.currentClass.classLevelId },
      });
      if (!reportWindow || reportWindow.status !== ReportWindowStatus.OPEN) {
        throw new BadRequestException("The report window is not open for class-teacher comments");
      }
    } else {
      const principal = await this.staffAssignments.findActiveAssignment({
        userId: user.id,
        assignmentType: AssignmentType.PRINCIPAL,
      });
      const headteacher =
        principal ??
        (await this.staffAssignments.findActiveAssignment({
          userId: user.id,
          assignmentType: AssignmentType.HEADTEACHER,
        }));
      if (!headteacher) {
        throw new ForbiddenException("You must hold an active PRINCIPAL or HEADTEACHER assignment");
      }
      authorStaffId = headteacher.staffId;
    }

    // SUBJECT (non-null subjectId) can use the compound-unique upsert
    // directly. CLASS_TEACHER/PRINCIPAL (subjectId always null) can't — a
    // standard unique index can't match on NULL, so Prisma's own typing
    // refuses `subjectId: null` in that compound-key lookup (the same
    // NULL-non-equality issue the hand-added partial index works around at
    // the DB level, see the model comment). A plain findFirst-then-branch
    // covers it instead, same "app-level check, index as backstop"
    // precedent as StaffAssignment's class-teacher-duplicate check.
    if (dto.subjectId) {
      return this.prisma.reportComment.upsert({
        where: {
          studentId_termId_commentType_subjectId: {
            studentId: dto.studentId,
            termId: dto.termId,
            commentType: dto.commentType,
            subjectId: dto.subjectId,
          },
        },
        create: { ...dto, authorStaffId },
        update: { comment: dto.comment, authorStaffId },
      });
    }

    const existing = await this.prisma.reportComment.findFirst({
      where: { studentId: dto.studentId, termId: dto.termId, commentType: dto.commentType, subjectId: null },
    });
    if (existing) {
      return this.prisma.reportComment.update({
        where: { id: existing.id },
        data: { comment: dto.comment, authorStaffId },
      });
    }
    return this.prisma.reportComment.create({
      data: { studentId: dto.studentId, termId: dto.termId, commentType: dto.commentType, comment: dto.comment, authorStaffId },
    });
  }

  findAll(filters: { studentId?: string; termId?: string }) {
    return this.prisma.reportComment.findMany({ where: filters });
  }
}

@Controller("report-comments")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class ReportCommentController {
  constructor(
    private readonly service: ReportCommentService,
    private readonly abilityFactory: AbilityFactory,
  ) {}

  @Post()
  write(@Body() dto: CreateReportCommentDto, @CurrentUser() user: RequestUser) {
    const ability = this.abilityFactory.createForUser(user);
    const isOverride = ability.can("manage", "ReportComment");
    return this.service.write(dto, user, isOverride);
  }

  @Get()
  findAll(@Query("studentId") studentId?: string, @Query("termId") termId?: string) {
    return this.service.findAll({ studentId, termId });
  }
}
