import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import type { ClassLevelCategory } from "@prisma/client";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { DashboardService } from "./dashboard.service";

/**
 * `@UseGuards(JwtAuthGuard)` only — no `PoliciesGuard`/`@CheckPolicies` here.
 * Every route below is manually gated inside DashboardService (see its own
 * class comment for why CASL doesn't fit a subject-spanning module like
 * this one).
 */
@Controller("dashboard")
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get("finance-overview")
  financeOverview(@CurrentUser() user: RequestUser, @Query("termId") termId: string) {
    return this.service.financeOverview(user, termId);
  }

  @Get("school-composition")
  schoolComposition(@CurrentUser() user: RequestUser, @Query("academicSessionId") academicSessionId: string) {
    return this.service.schoolComposition(user, academicSessionId);
  }

  @Get("audit-highlights")
  auditHighlights(@CurrentUser() user: RequestUser, @Query("take") take?: string) {
    return this.service.auditHighlights(user, take === undefined ? 15 : Number(take));
  }

  @Get("invitation-trend")
  invitationTrend(@CurrentUser() user: RequestUser, @Query("weeks") weeks?: string) {
    return this.service.invitationTrend(user, weeks === undefined ? 8 : Number(weeks));
  }

  @Get("schedule-approvals-summary")
  scheduleApprovalsSummary(@CurrentUser() user: RequestUser) {
    return this.service.scheduleApprovalsSummary(user);
  }

  @Get("score-entry-completion")
  scoreEntryCompletion(
    @CurrentUser() user: RequestUser,
    @Query("termId") termId: string,
    @Query("classLevelCategory") classLevelCategory: ClassLevelCategory,
  ) {
    return this.service.scoreEntryCompletion(user, termId, classLevelCategory);
  }

  @Get("attendance-insights")
  attendanceInsights(@CurrentUser() user: RequestUser, @Query("termId") termId: string, @Query("classArmId") classArmId?: string) {
    return classArmId
      ? this.service.classAttendanceDailyTrend(user, termId, classArmId)
      : this.service.attendanceOverview(user, termId);
  }

  @Get("class-roster-summary")
  classRosterSummary(@CurrentUser() user: RequestUser, @Query("classArmId") classArmId: string) {
    return this.service.classRosterSummary(user, classArmId);
  }

  @Get("broadsheet-snapshot")
  broadsheetSnapshot(@CurrentUser() user: RequestUser, @Query("termId") termId: string) {
    return this.service.broadsheetSnapshot(user, termId);
  }

  @Get("my-attendance-summary")
  myAttendanceSummary(
    @CurrentUser() user: RequestUser,
    @Query("studentId") studentId: string,
    @Query("termId") termId: string,
  ) {
    return this.service.myAttendanceSummary(user, studentId, termId);
  }
}
