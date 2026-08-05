import {
  BadRequestException,
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
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { EnrollmentStatus, ReportCommentType, TermReportCardStatus, TermReportCardType } from "@prisma/client";
import { QUEUE_NAMES, type ReportCardGenerationJob } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { StaffAssignmentService } from "../staff-assignments/staff-assignment";
import { GenerateTermReportCardDto } from "./dto/generate-term-report-card.dto";

@Injectable()
export class TermReportCardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly staffAssignments: StaffAssignmentService,
    @InjectQueue(QUEUE_NAMES.REPORT_CARD_GENERATION) private readonly reportCardQueue: Queue<ReportCardGenerationJob>,
  ) {}

  /**
   * PRD FR4.7/§3.6: Admin-initiated for v1 — not auto-triggered when all
   * required pieces happen to become ready, which is simpler and safer.
   * Generation itself always succeeds (renders whatever exists); the
   * completeness gate lives in publish(), not here, so Admin can preview a
   * still-incomplete card before every piece is in.
   */
  async generateFullTerm(dto: GenerateTermReportCardDto, userId: string) {
    const reportCard = await this.prisma.termReportCard.upsert({
      where: {
        studentId_termId_reportType: { studentId: dto.studentId, termId: dto.termId, reportType: TermReportCardType.FULL_TERM },
      },
      create: {
        studentId: dto.studentId,
        termId: dto.termId,
        reportType: TermReportCardType.FULL_TERM,
        status: TermReportCardStatus.GENERATING,
        generatedByUserId: userId,
      },
      update: { status: TermReportCardStatus.GENERATING, generatedByUserId: userId },
    });

    await this.reportCardQueue.add("generate", {
      studentId: dto.studentId,
      termId: dto.termId,
      reportType: "FULL_TERM",
    });

    // Returned so the response body isn't empty — an empty 201 body made
    // apiFetch's res.json() throw on the frontend, which read as a failure
    // even though generation had actually been queued successfully.
    return reportCard;
  }

  async publish(id: string) {
    const reportCard = await this.prisma.termReportCard.findUniqueOrThrow({ where: { id } });
    // MID_TERM's gate is scores-only (no comments/skills) — READY just means
    // the PDF finished generating. FULL_TERM additionally requires every
    // piece FR4.7 lists, checked here rather than at generation time.
    if (reportCard.status !== TermReportCardStatus.READY) {
      throw new BadRequestException(`Cannot publish a report card with status ${reportCard.status}`);
    }
    if (reportCard.reportType === TermReportCardType.FULL_TERM) {
      await this.assertFullTermPublishGate(reportCard.studentId, reportCard.termId);
    }
    return this.prisma.termReportCard.update({
      where: { id },
      data: { status: TermReportCardStatus.PUBLISHED, publishedAt: new Date() },
    });
  }

  private async assertFullTermPublishGate(studentId: string, termId: string): Promise<void> {
    const student = await this.prisma.studentProfile.findUniqueOrThrow({
      where: { id: studentId },
      include: { currentClass: true },
    });
    if (!student.currentClass) {
      throw new BadRequestException("Student has no current class — cannot publish a full-term report card");
    }
    const term = await this.prisma.term.findUniqueOrThrow({ where: { id: termId } });

    const enrollments = await this.prisma.studentSubjectEnrollment.findMany({
      where: { studentId, classArmId: student.currentClass.id, termId, status: EnrollmentStatus.ACTIVE },
    });
    const results = await this.prisma.subjectTermResult.findMany({ where: { studentId, termId } });
    const missingSubjects = enrollments.filter((e) => !results.some((r) => r.subjectId === e.subjectId));
    if (missingSubjects.length > 0) {
      throw new BadRequestException(
        `Missing SubjectTermResult for ${missingSubjects.length} actively-enrolled subject(s)`,
      );
    }

    const activeSkillItems = await this.prisma.skillAssessmentItem.findMany({
      where: { academicSessionId: term.academicSessionId, isActive: true },
    });
    const ratings = await this.prisma.skillRating.findMany({ where: { studentId, termId } });
    const missingSkills = activeSkillItems.filter((item) => !ratings.some((r) => r.skillAssessmentItemId === item.id));
    if (missingSkills.length > 0) {
      throw new BadRequestException(`Missing SkillRating for ${missingSkills.length} active skill assessment item(s)`);
    }

    const classTeacherComment = await this.prisma.reportComment.findFirst({
      where: { studentId, termId, commentType: ReportCommentType.CLASS_TEACHER },
    });
    if (!classTeacherComment) {
      throw new BadRequestException("Missing CLASS_TEACHER comment");
    }

    const principalComment = await this.prisma.reportComment.findFirst({
      where: { studentId, termId, commentType: ReportCommentType.PRINCIPAL },
    });
    if (!principalComment) {
      throw new BadRequestException("Missing PRINCIPAL comment");
    }
  }

  /**
   * PRD §5: Super-Admin/Admin see every report card regardless of status
   * (they're the ones who publish it); class/subject teacher (STAFF) see
   * their own class's cards, any status; parents see only their wards' and
   * students see only their own, both published-only — same row-level
   * scoping shape as StudentService.findAllForUser (identity/students/
   * student.ts), applied here to TermReportCard instead of StudentProfile.
   */
  async findForUser(user: RequestUser, filters: { studentId?: string; termId?: string }) {
    if (user.roles.includes("SUPER_ADMIN") || user.roles.includes("ADMIN")) {
      return this.prisma.termReportCard.findMany({
        where: filters,
        orderBy: { createdAt: "desc" },
      });
    }

    if (user.roles.includes("STAFF")) {
      // PRD §5: class/subject teacher see report cards for their own
      // class(es) — not published-only, unlike parent/student, since staff
      // may need to review a card before it's published.
      const classArmIds = await this.staffAssignments.activeAssignedClassArmIds(user.id);
      if (classArmIds.length === 0) return [];
      return this.prisma.termReportCard.findMany({
        where: { ...filters, student: { currentClassId: { in: classArmIds } } },
        orderBy: { createdAt: "desc" },
      });
    }

    if (user.roles.includes("PARENT")) {
      const parentProfile = await this.prisma.parentProfile.findUnique({ where: { userId: user.id } });
      if (!parentProfile) return [];
      return this.prisma.termReportCard.findMany({
        where: {
          ...filters,
          status: TermReportCardStatus.PUBLISHED,
          student: { guardians: { some: { parentId: parentProfile.id } } },
        },
        orderBy: { createdAt: "desc" },
      });
    }

    if (user.roles.includes("STUDENT")) {
      const studentProfile = await this.prisma.studentProfile.findUnique({ where: { userId: user.id } });
      if (!studentProfile) return [];
      return this.prisma.termReportCard.findMany({
        where: { ...filters, studentId: studentProfile.id, status: TermReportCardStatus.PUBLISHED },
        orderBy: { createdAt: "desc" },
      });
    }

    return [];
  }

  async remove(id: string) {
    return this.prisma.termReportCard.delete({ where: { id } });
  }
}

@Controller("term-report-cards")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class TermReportCardController {
  constructor(private readonly service: TermReportCardService) {}

  @Post("generate")
  @CheckPolicies((ability) => ability.can("manage", "TermReportCard"))
  generate(@Body() dto: GenerateTermReportCardDto, @CurrentUser() user: RequestUser) {
    return this.service.generateFullTerm(dto, user.id);
  }

  @Get()
  findAll(
    @CurrentUser() user: RequestUser,
    @Query("studentId") studentId?: string,
    @Query("termId") termId?: string,
  ) {
    return this.service.findForUser(user, { studentId, termId });
  }

  @Patch(":id/publish")
  @CheckPolicies((ability) => ability.can("manage", "TermReportCard"))
  publish(@Param("id") id: string) {
    return this.service.publish(id);
  }

  @Delete(":id")
  remove(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    // Super-Admin-only carve-out, not a plain CASL "manage" check — Admin
    // already has "manage" on TermReportCard (generate/publish), but
    // deleting a generated report card is reserved for the owner, same
    // pattern as the owner-only check in identity/ownership-transfer.ts.
    if (!user.roles.includes("SUPER_ADMIN")) {
      throw new ForbiddenException("Only the Super-Admin can delete a report card");
    }
    return this.service.remove(id);
  }
}
