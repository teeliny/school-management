/**
 * BullMQ queue names + job payload contracts shared between apps/api
 * (producer) and apps/worker (consumer) — see ARCHITECTURE.md §8. Kept here
 * rather than duplicated per-app since producer and consumer must agree on
 * the exact payload shape.
 */
export const QUEUE_NAMES = {
  ASSESSMENT_SCHEDULE_SWEEP: "assessment-schedule-sweep",
  REPORT_CARD_GENERATION: "report-card-generation",
  RECEIPT_GENERATION: "receipt-generation",
  PAYMENT_RECONCILIATION: "payment-reconciliation",
  EMAIL_DISPATCH: "email-dispatch",
  INVOICE_OVERDUE_SWEEP: "invoice-overdue-sweep",
  SUBJECT_TERM_RESULT_RECOMPUTE: "subject-term-result-recompute",
  SCHEDULING_SOLVE_DISPATCH: "scheduling-solve-dispatch",
  SCHEDULING_TIMEOUT_SWEEP: "scheduling-timeout-sweep",
} as const;

export interface ReportCardGenerationJob {
  studentId: string;
  termId: string;
  reportType: "MID_TERM" | "FULL_TERM";
}

// Fired when a student explicitly opts into a subject (StudentSubjectEnrollmentService.enroll)
// so the broadsheet reflects it immediately instead of waiting on the next
// assessment-schedule-sweep tick, which only re-aggregates a whole
// class-category/term batch on a component-close transition.
export interface SubjectTermResultRecomputeJob {
  studentId: string;
  subjectId: string;
  classArmId: string;
  termId: string;
}

export interface ReceiptGenerationJob {
  receiptId: string;
}

// ARCHITECTURE.md §9: the dispatch job only ever carries the request id — the
// processor re-fetches the ScheduleGenerationRequest, resolves its
// SchedulingConstraint rows, and builds the /solve payload from the DB at
// process time, same "re-fetch, don't embed" shape as every other job here.
export interface SchedulingSolveDispatchJob {
  requestId: string;
}

export interface EmailDispatchJob {
  emailLogId: string;
  recipientEmail: string;
  subject: string;
  body: string;
}
