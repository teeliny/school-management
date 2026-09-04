import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { QUEUE_NAMES } from "@school/types";
import { SubjectController, SubjectService } from "./subject";
import { ClassSubjectController, ClassSubjectService } from "./class-subject";
import {
  ClassSubjectConcurrencyGroupController,
  ClassSubjectConcurrencyGroupService,
} from "./class-subject-concurrency-group";
import { ClassSubjectTermStatusController, ClassSubjectTermStatusService } from "./class-subject-term-status";
import { ClassSubjectLevelStatusController, ClassSubjectLevelStatusService } from "./class-subject-level-status";
import { SubjectGroupWeightController, SubjectGroupWeightService } from "./subject-group-weight";
import { StudentSubjectEnrollmentController, StudentSubjectEnrollmentService } from "./student-subject-enrollment";

// Maps to ARCHITECTURE.md §5's SubjectModule — depends on
// AcademicStructureModule (ClassLevel/Department), satisfied via
// PrismaService directly (no cross-module service calls needed here).
// Exports StudentSubjectEnrollmentService since IdentityModule's
// StudentService needs it for the compulsory auto-enroll hook, and
// ClassSubjectTermStatusService/ClassSubjectLevelStatusService since
// AssessmentsModule's ScoreEntryService needs them for the per-term/
// per-class-level disable checks.
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.SUBJECT_TERM_RESULT_RECOMPUTE })],
  controllers: [
    SubjectController,
    ClassSubjectController,
    ClassSubjectConcurrencyGroupController,
    ClassSubjectTermStatusController,
    ClassSubjectLevelStatusController,
    SubjectGroupWeightController,
    StudentSubjectEnrollmentController,
  ],
  providers: [
    SubjectService,
    ClassSubjectService,
    ClassSubjectConcurrencyGroupService,
    ClassSubjectTermStatusService,
    ClassSubjectLevelStatusService,
    SubjectGroupWeightService,
    StudentSubjectEnrollmentService,
  ],
  exports: [SubjectService, StudentSubjectEnrollmentService, ClassSubjectTermStatusService, ClassSubjectLevelStatusService],
})
export class SubjectModule {}
