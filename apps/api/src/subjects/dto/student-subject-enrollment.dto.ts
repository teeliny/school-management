import { ArrayMinSize, IsArray, IsUUID } from "class-validator";

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

// Same shape as CreateEnrollmentDto but for opting a student into several
// subjects in one request — StudentSubjectEnrollmentService.enrollMany
// resolves each subjectId via the existing single enroll(), so per-subject
// validation (COMPULSORY rejection, DEPARTMENT match, term status) is
// identical either way.
export class CreateBulkEnrollmentDto {
  @IsUUID()
  studentId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID(undefined, { each: true })
  subjectIds!: string[];

  @IsUUID()
  classArmId!: string;

  @IsUUID()
  academicSessionId!: string;

  @IsUUID()
  termId!: string;
}
