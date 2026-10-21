import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  Injectable,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  EnrollmentStatus,
  ReportCommentType,
  ReportWindowStatus,
  SkillGroupValueType,
  SkillRatingValue,
} from "@prisma/client";
import {
  containsHarshWording,
  forbiddenPronounRegex,
  mentionsOnlyBand,
  performanceBand,
  pronounsFor,
  type CommentSuggestionResponse,
  type PerformanceBand,
  type PronounSet,
} from "@school/types";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { AbilityFactory } from "../casl/ability.factory";
import { ReportCommentService } from "./report-comment";
import { BroadsheetService } from "./broadsheet";
import { CommentLlmGenerator, type LlmCommentInput } from "./comment-llm";
import { classTeacherSuggestions, principalSuggestions, type SkillSummary } from "./comment-templates";
import { CommentSuggestionDto } from "./dto/comment-suggestion.dto";

const SUGGESTION_COUNT = 5;

/**
 * Whether a generated comment is safe to show: a sensible length, no
 * leftover template tokens, only the student's own pronouns (none at all
 * when gender is unknown), nothing from HARSH_WORDS and, for PRINCIPAL, its own band's phrase and no
 * other band's. Templates satisfy this by construction (see
 * comment-templates.spec.ts); LLM output is filtered through it.
 */
export function isAcceptableComment(
  comment: string,
  opts: { pronouns: PronounSet | null; band?: PerformanceBand },
): boolean {
  const text = comment.trim();
  if (text.length < 20 || text.length > 350) return false;
  if (/[{}<>]/.test(text)) return false;
  if (forbiddenPronounRegex(opts.pronouns).test(text)) return false;
  if (containsHarshWording(text)) return false;
  if (opts.band && !mentionsOnlyBand(text, opts.band)) return false;
  return true;
}

const STRENGTH: SkillRatingValue[] = [SkillRatingValue.EXCELLENT, SkillRatingValue.VERY_GOOD];
const WEAK: SkillRatingValue[] = [SkillRatingValue.FAIR, SkillRatingValue.POOR];

/**
 * Suggested CLASS_TEACHER / PRINCIPAL report comments. Advisory only:
 * nothing is written here, and the user saves a picked or edited comment
 * through the normal POST /report-comments.
 */
@Injectable()
export class CommentSuggestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reportComments: ReportCommentService,
    private readonly broadsheet: BroadsheetService,
    private readonly llm: CommentLlmGenerator,
  ) {}

  async suggest(dto: CommentSuggestionDto, user: RequestUser, isOverride: boolean): Promise<CommentSuggestionResponse> {
    const commentType = dto.commentType === "PRINCIPAL" ? ReportCommentType.PRINCIPAL : ReportCommentType.CLASS_TEACHER;
    await this.reportComments.authorize({ studentId: dto.studentId, termId: dto.termId, commentType }, user, isOverride);

    const student = await this.prisma.studentProfile.findUniqueOrThrow({
      where: { id: dto.studentId },
      include: { user: { select: { firstName: true, gender: true } } },
    });
    const firstName = student.user.firstName.trim();
    const pronouns = pronounsFor(student.user.gender);
    const ctx = { firstName, pronouns, seed: `${dto.studentId}:${dto.termId}:${dto.attempt ?? 0}` };

    // A class teacher only gets suggestions while the class group's report
    // window is OPEN. Override users (Principal/Headteacher/Vice-Principal,
    // Admin, Super-Admin: CASL "manage ReportComment") can generate whatever
    // the window's state, matching how they can already write comments.
    if (!isOverride) {
      await this.assertReportWindowOpen(dto.termId, student.currentClassId);
    }

    if (dto.commentType === "CLASS_TEACHER") {
      const skills = await this.skillSummary(dto);
      const templates = classTeacherSuggestions(skills, ctx, SUGGESTION_COUNT);
      return this.withLlm(templates, { commentType: "CLASS_TEACHER", firstName, pronouns, skills });
    }

    const average = await this.completedAverage(dto.studentId, dto.termId, student.currentClassId);
    const band = performanceBand(average);
    const templates = principalSuggestions(band, ctx, SUGGESTION_COUNT);
    const result = await this.withLlm(templates, { commentType: "PRINCIPAL", firstName, pronouns, band });
    return { ...result, band, average: Math.round(average * 100) / 100 };
  }

  /** LLM suggestions first (when enabled and valid), topped up from templates. */
  private async withLlm(
    templates: string[],
    input: Omit<LlmCommentInput, "count">,
  ): Promise<CommentSuggestionResponse> {
    if (!this.llm.enabled) return { suggestions: templates, source: "template" };

    const generated = await this.llm.generate({ ...input, count: SUGGESTION_COUNT });
    const valid: string[] = [];
    for (const raw of generated) {
      const comment = raw.trim().replace(/\s+/g, " ");
      if (isAcceptableComment(comment, { pronouns: input.pronouns, band: input.band }) && !valid.includes(comment)) {
        valid.push(comment);
      }
    }
    if (valid.length === 0) return { suggestions: templates, source: "template" };
    const suggestions = [...valid, ...templates.filter((t) => !valid.includes(t))].slice(0, SUGGESTION_COUNT);
    return { suggestions, source: "llm" };
  }

  private async skillSummary(dto: CommentSuggestionDto): Promise<SkillSummary> {
    let rated: { name: string; rating: SkillRatingValue; order: number }[];
    if (dto.skillRatings) {
      const items = await this.prisma.skillAssessmentItem.findMany({
        where: { id: { in: dto.skillRatings.map((r) => r.skillAssessmentItemId) } },
        include: { group: true },
      });
      rated = dto.skillRatings.flatMap((r) => {
        const item = items.find((i) => i.id === r.skillAssessmentItemId);
        return item && item.group.valueType === SkillGroupValueType.RATING
          ? [{ name: item.name, rating: r.rating, order: item.group.order * 1000 + item.order }]
          : [];
      });
    } else {
      const saved = await this.prisma.skillRating.findMany({
        where: { studentId: dto.studentId, termId: dto.termId, rating: { not: null } },
        include: { skillAssessmentItem: { include: { group: true } } },
      });
      rated = saved.flatMap((r) =>
        r.rating && r.skillAssessmentItem.group.valueType === SkillGroupValueType.RATING
          ? [
              {
                name: r.skillAssessmentItem.name,
                rating: r.rating,
                order: r.skillAssessmentItem.group.order * 1000 + r.skillAssessmentItem.order,
              },
            ]
          : [],
      );
    }
    if (rated.length === 0) {
      throw new BadRequestException("Rate at least one skill before generating comments");
    }

    // Best-rated first, so "strengths" leads with the student's top skills.
    const rank = (r: SkillRatingValue) =>
      [SkillRatingValue.EXCELLENT, SkillRatingValue.VERY_GOOD, SkillRatingValue.GOOD, SkillRatingValue.FAIR, SkillRatingValue.POOR].indexOf(r);
    rated.sort((a, b) => rank(a.rating) - rank(b.rating) || a.order - b.order);
    return {
      strengths: rated.filter((r) => STRENGTH.includes(r.rating)).map((r) => r.name),
      satisfactory: rated.filter((r) => r.rating === SkillRatingValue.GOOD).map((r) => r.name),
      weak: rated.filter((r) => WEAK.includes(r.rating)).map((r) => r.name),
    };
  }

  /**
   * For non-override users, suggestions are only generated while the class
   * group's report window is OPEN. Nothing ever creates a window here: no
   * window (or a DRAFT/CLOSED one) simply means no suggestions.
   */
  private async assertReportWindowOpen(termId: string, classArmId: string | null): Promise<void> {
    if (!classArmId) {
      throw new BadRequestException("Student has no current class");
    }
    const arm = await this.prisma.classArm.findUniqueOrThrow({
      where: { id: classArmId },
      include: { classLevel: true },
    });
    const window = await this.prisma.reportWindow.findFirst({
      where: { termId, classLevelCategory: arm.classLevel.category },
    });
    if (window?.status !== ReportWindowStatus.OPEN) {
      throw new ConflictException("Suggested comments are only available while the report window is open");
    }
  }

  /**
   * The student's term average, but only once their result is complete:
   * every ACTIVE subject enrolment has a SubjectTermResult (the same rule as
   * TermReportCardService's publish gate). The average is the broadsheet's
   * `overallAverage`, i.e. exactly the figure the principal panel shows.
   */
  private async completedAverage(studentId: string, termId: string, classArmId: string | null): Promise<number> {
    if (!classArmId) {
      throw new BadRequestException("Student has no current class");
    }
    const [enrollments, results] = await Promise.all([
      this.prisma.studentSubjectEnrollment.findMany({
        where: { studentId, classArmId, termId, status: EnrollmentStatus.ACTIVE },
        select: { subjectId: true },
      }),
      this.prisma.subjectTermResult.findMany({ where: { studentId, termId }, select: { subjectId: true } }),
    ]);
    const missing = enrollments.filter((e) => !results.some((r) => r.subjectId === e.subjectId)).length;
    if (enrollments.length === 0 || missing > 0) {
      throw new ConflictException(
        enrollments.length === 0
          ? "Results incomplete: the student has no subject enrolments this term"
          : `Results incomplete: ${missing} subject(s) still have no result`,
      );
    }

    const sheet = await this.broadsheet.build({ termId, classArmId });
    const average = sheet.rows.find((row) => row.studentId === studentId)?.overallAverage;
    if (average === null || average === undefined) {
      throw new ConflictException("Results incomplete: no overall average yet");
    }
    return average;
  }
}

@Controller("report-comments/suggestions")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class CommentSuggestionController {
  constructor(
    private readonly service: CommentSuggestionService,
    private readonly abilityFactory: AbilityFactory,
  ) {}

  @Post()
  @HttpCode(200)
  suggest(@Body() dto: CommentSuggestionDto, @CurrentUser() user: RequestUser) {
    const isOverride = this.abilityFactory.createForUser(user).can("manage", "ReportComment");
    return this.service.suggest(dto, user, isOverride);
  }
}
