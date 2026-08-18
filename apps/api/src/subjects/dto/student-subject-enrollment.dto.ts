import { IsUUID } from "class-validator";

// GENERAL/DEPARTMENT explicit opt-in (PRD §3.3 FR2.5) — COMPULSORY subjects
// auto-enroll via StudentSubjectEnrollmentService.syncCompulsoryEnrollmentsOnClassAssignment
// and reject this path (see enroll()).
export class CreateEnrollmentDto {
  @IsUUID()
  studentId!: string;

  @IsUUID()
  subjectId!: string;

  @IsUUID()
  classArmId!: string;

  @IsUUID()
  academicSessionId!: string;

  @IsUUID()
  termId!: string;
}
