import { Module } from "@nestjs/common";
import { SubjectController, SubjectService } from "./subject";
import { ClassSubjectController, ClassSubjectService } from "./class-subject";
import { SubjectGroupWeightController, SubjectGroupWeightService } from "./subject-group-weight";
import { StudentSubjectEnrollmentController, StudentSubjectEnrollmentService } from "./student-subject-enrollment";

// Maps to ARCHITECTURE.md §5's SubjectModule — depends on
// AcademicStructureModule (ClassLevel/Department), satisfied via
// PrismaService directly (no cross-module service calls needed here).
// Exports StudentSubjectEnrollmentService since IdentityModule's
// StudentService needs it for the compulsory auto-enroll hook.
@Module({
  controllers: [
    SubjectController,
    ClassSubjectController,
    SubjectGroupWeightController,
    StudentSubjectEnrollmentController,
  ],
  providers: [SubjectService, ClassSubjectService, SubjectGroupWeightService, StudentSubjectEnrollmentService],
  exports: [SubjectService, StudentSubjectEnrollmentService],
})
export class SubjectModule {}
