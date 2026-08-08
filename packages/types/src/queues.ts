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
} as const;

export interface ReportCardGenerationJob {
  studentId: string;
  termId: string;
  reportType: "MID_TERM" | "FULL_TERM";
}

export interface ReceiptGenerationJob {
  receiptId: string;
}
