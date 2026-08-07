import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { QUEUE_NAMES } from "@school/types";
import { AssessmentComponentController, AssessmentComponentService } from "./assessment-component";
import { ScoreEntryController, ScoreEntryService } from "./score-entry";
import { GradeScaleController, GradeScaleService } from "./grade-scale";
import { TermReportCardController, TermReportCardService } from "./term-report-card";
import { SkillAssessmentItemController, SkillAssessmentItemService } from "./skill-assessment-item";
import { ReportWindowController, ReportWindowService } from "./report-window";
import { SkillRatingController, SkillRatingService } from "./skill-rating";
import { ReportCommentController, ReportCommentService } from "./report-comment";
import { BroadsheetController, BroadsheetService } from "./broadsheet";
import { StaffAssignmentsModule } from "../staff-assignments/staff-assignments.module";
import { SubjectModule } from "../subjects/subject.module";

// Maps to ARCHITECTURE.md §5's AssessmentModule — depends on
// StaffAssignmentsModule for the row-level "is this the assigned subject
// teacher/class teacher" checks ScoreEntry/SkillRating/ReportComment need,
// and SubjectModule for the per-term disabled-subject check ScoreEntry needs.
@Module({
  imports: [
    StaffAssignmentsModule,
    SubjectModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.REPORT_CARD_GENERATION }),
  ],
  controllers: [
    AssessmentComponentController,
    ScoreEntryController,
    GradeScaleController,
    TermReportCardController,
    SkillAssessmentItemController,
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
    ReportWindowService,
    SkillRatingService,
    ReportCommentService,
    BroadsheetService,
  ],
})
export class AssessmentsModule {}
