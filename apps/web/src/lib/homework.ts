import { apiFetch } from "./api";

// Response shapes for apps/api/src/homework/homework.ts (PRD §3.6a).
// Decimal columns (maxScore/score) arrive as strings — wrap in Number().

export type HomeworkStatus = "DRAFT" | "PUBLISHED" | "CLOSED";

export interface HomeworkSummary {
  id: string;
  subjectId: string;
  classArmId: string;
  termId: string;
  title: string;
  instructions: string;
  dueDate: string;
  maxScore: string | number | null;
  allowOnlineSubmission: boolean;
  status: HomeworkStatus;
  publishedAt: string | null;
  caComponentId: string | null;
  caTransferredAt: string | null;
  subject: { id: string; name: string; code: string };
  classArm: { id: string; name: string; classLevelId: string; classLevel: { name: string; category: string } };
  term: { id: string; name: string };
  caComponent: { id: string; name: string; type: string; maxScore: string | number; status: string } | null;
  createdByUser: { firstName: string; lastName: string };
}

export interface HomeworkListItem extends HomeworkSummary {
  _count: { marks: number; submissions: number; attachments: number };
  // Guardian/student view only: the viewer's own students' marks/submissions.
  marks: { studentId: string; score: string | number | null; markedAt: string }[];
  submissions: { studentId: string; submittedAt: string; isLate: boolean }[];
  wardStudentIds: string[];
}

export interface HomeworkFile {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
}

export interface HomeworkRosterRow {
  student: { id: string; admissionNumber: string; firstName: string; lastName: string };
  submission: {
    id: string;
    text: string | null;
    isLate: boolean;
    submittedAt: string;
    updatedAt: string;
    files: HomeworkFile[];
  } | null;
  mark: {
    id: string;
    score: string | number | null;
    correction: string | null;
    correctionFileName: string | null;
    correctionUrl: string | null;
    markedAt: string;
    updatedAt: string;
    changedSinceTransfer: boolean;
  } | null;
}

export interface HomeworkDetail extends HomeworkSummary {
  viewerCanManage: boolean;
  attachments: HomeworkFile[];
  roster: HomeworkRosterRow[];
}

export interface HomeworkTransferPlan {
  component: { id: string; name: string; maxScore: number; status: string };
  homeworkMaxScore: number;
  rows: {
    studentId: string;
    studentName: string;
    homeworkScore: number;
    scaledScore: number;
    existingScore: number | null;
    existingFromThisHomework: boolean;
  }[];
  unmarked: { studentId: string; studentName: string }[];
}

// Mirrors the API's ALLOWED_HOMEWORK_MIME_TYPES / 10 MB limit.
export const HOMEWORK_FILE_ACCEPT = ".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp";
export const HOMEWORK_MAX_FILE_BYTES = 10 * 1024 * 1024;

export function maxScoreOf(homework: { maxScore: string | number | null }): number | null {
  return homework.maxScore === null ? null : Number(homework.maxScore);
}

export function formatDueDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function isOverdue(iso: string) {
  const due = new Date(iso);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return today > due.getTime();
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Every homework file route takes one multipart `file` field. */
export function uploadHomeworkFile(path: string, file: File) {
  const body = new FormData();
  body.append("file", file);
  return apiFetch(path, { method: "POST", auth: true, body });
}
