import type { ClassLevelCategory } from "./class-level-category";

/**
 * GET /dashboard/assessment-progress — completion *counts* only (never a
 * student list) for every assessment/comment that feeds a term report card,
 * so Super-Admin/Admin/Registrar/Principal/VP/Headteacher can spot what's
 * still outstanding per class, per subject, or per teacher.
 */
export interface ProgressCount {
  completed: number;
  total: number;
}

export interface AssessmentProgressStaff {
  staffId: string;
  name: string;
}

export type AssessmentProgressComponentType = "CA" | "MID_TERM" | "EXAM";
export type AssessmentProgressComponentStatus = "OPEN" | "CLOSED" | "PUBLISHED";

export interface AssessmentProgressComponent {
  componentId: string;
  type: AssessmentProgressComponentType;
  name: string;
  status: AssessmentProgressComponentStatus;
  completed: number;
}

export interface AssessmentProgressSubject {
  subjectId: string;
  subjectName: string;
  /** Empty when nobody holds an active SUBJECT_TEACHER assignment for it. */
  teachers: AssessmentProgressStaff[];
  /** Students actively enrolled in this subject for the term. */
  total: number;
  components: AssessmentProgressComponent[];
}

export interface AssessmentProgressClass {
  classArmId: string;
  className: string;
  classLevelCategory: ClassLevelCategory;
  totalStudents: number;
  classTeachers: AssessmentProgressStaff[];
  /** Principal (JSS/SSS) or Headteacher (Creche–Primary) — whoever writes the PRINCIPAL comment. */
  principalCommentOwners: AssessmentProgressStaff[];
  classTeacherComments: ProgressCount;
  principalComments: ProgressCount;
  /** Null when no active skill item applies to this class's category. */
  skills: ProgressCount | null;
  subjects: AssessmentProgressSubject[];
}

export interface AssessmentProgressResponse {
  termId: string;
  termName: string;
  classes: AssessmentProgressClass[];
}
