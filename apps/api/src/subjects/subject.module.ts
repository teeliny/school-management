import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { QUEUE_NAMES } from "@school/types";
import { SubjectController, SubjectService } from "./subject";
import { ClassSubjectController, ClassSubjectService } from "./class-subject";
import { ClassSubjectTermStatusController, ClassSubjectTermStatusService } from "./class-subject-term-status";
import { SubjectGroupWeightController, SubjectGroupWeightService } from "./subject-group-weight";
import { StudentSubjectEnrollmentController, StudentSubjectEnrollmentService } from "./student-subject-enrollment";

// Maps to ARCHITECTURE.md §5's SubjectModule — depends on
// AcademicStructureModule (ClassLevel/Department), satisfied via
// PrismaService directly (no cross-module service calls needed here).
// Exports StudentSubjectEnrollmentService since IdentityModule's
// StudentService needs it for the compulsory auto-enroll hook, and
// ClassSubjectTermStatusService since AssessmentsModule's ScoreEntryService
// needs it for the per-term disable check.
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.SUBJECT_TERM_RESULT_RECOMPUTE })],
  controllers: [
    SubjectController,
    ClassSubjectController,
    ClassSubjectTermStatusController,
    SubjectGroupWeightController,
    StudentSubjectEnrollmentController,
  ],
  providers: [
    SubjectService,
    ClassSubjectService,
    ClassSubjectTermStatusService,
    SubjectGroupWeightService,
    StudentSubjectEnrollmentService,
  ],
  exports: [SubjectService, StudentSubjectEnrollmentService, ClassSubjectTermStatusService],
})
export class SubjectModule {}
