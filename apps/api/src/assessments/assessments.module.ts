import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { QUEUE_NAMES } from "@school/types";
import { AssessmentComponentController, AssessmentComponentService } from "./assessment-component";
import { ScoreEntryController, ScoreEntryService } from "./score-entry";
import { GradeScaleController, GradeScaleService } from "./grade-scale";
import { TermReportCardController, TermReportCardService, ReportCardVerificationController } from "./term-report-card";
import { SkillAssessmentItemController, SkillAssessmentItemService } from "./skill-assessment-item";
import { SkillGroupController, SkillGroupService } from "./skill-group";
import { ReportWindowController, ReportWindowService } from "./report-window";
import { SkillRatingController, SkillRatingService } from "./skill-rating";
import { ReportCommentController, ReportCommentService } from "./report-comment";
import { BroadsheetController, BroadsheetService } from "./broadsheet";
import { StaffAssignmentsModule } from "../staff-assignments/staff-assignments.module";
import { SubjectModule } from "../subjects/subject.module";
import { NotificationsModule } from "../notifications/notifications.module";

// Maps to ARCHITECTURE.md §5's AssessmentModule — depends on
// StaffAssignmentsModule for the row-level "is this the assigned subject
// teacher/class teacher" checks ScoreEntry/SkillRating/ReportComment need,
// and SubjectModule for the per-term disabled-subject check ScoreEntry needs.
@Module({
  imports: [
    StaffAssignmentsModule,
    SubjectModule,
    NotificationsModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.REPORT_CARD_GENERATION }),
  ],
  controllers: [
    AssessmentComponentController,
    ScoreEntryController,
    GradeScaleController,
    TermReportCardController,
    ReportCardVerificationController,
    SkillAssessmentItemController,
    SkillGroupController,
    ReportWindowController,
    SkillRatingController,
    ReportCommentController,
    BroadsheetController,
  ],
  providers: [
    AssessmentComponentService,
    ScoreEntryService,
    GradeScaleService,
    TermReportCardService,
    SkillAssessmentItemService,
    SkillGroupService,
    ReportWindowService,
    SkillRatingService,
    ReportCommentService,
    BroadsheetService,
  ],
  // BroadsheetService is consumed directly by DashboardModule's Principal/
  // Headteacher broadsheet-snapshot widget (BUILD_PLAN.md §10) — computing
  // it fresh per request rather than duplicating ~200 lines of subject-
  // weighting/positioning logic the way cross-process boundaries force
  // elsewhere (see BroadsheetService's own comment).
  exports: [BroadsheetService],
})
export class AssessmentsModule {}
