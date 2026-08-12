/**
 * Mirrors the Prisma `NotificationType`/`NotificationChannel` enums
 * (prisma/schema.prisma) — plain string unions so apps/web can use these
 * without depending on @prisma/client, same pattern as fees-rules.ts's
 * `InvoiceStatus`.
 */
export type NotificationType =
  | "REPORT_CARD_PUBLISHED"
  | "INVOICE_OVERDUE"
  | "PASSWORD_RESET"
  | "INVITATION_RECEIVED"
  | "PAYMENT_RECEIVED"
  | "DISCOUNT_REQUEST_APPROVED"
  | "DISCOUNT_REQUEST_REJECTED"
  | "MANUAL_PAYMENT_APPROVED"
  | "MANUAL_PAYMENT_REJECTED"
  | "SCHEDULE_GENERATION_COMPLETED"
  | "SCHEDULE_GENERATION_TIMED_OUT"
  | "SCHEDULE_GENERATION_FAILED";

export type NotificationChannel = "IN_APP" | "EMAIL" | "BOTH";

export interface DefaultNotificationTemplate {
  key: NotificationType;
  channel: NotificationChannel;
  subject: string;
  bodyTemplate: string;
  isCritical: boolean;
}

/**
 * Shipped default copy, seeded into `NotificationTemplate` by
 * `pnpm setup:school` (apps/api/src/setup-school.ts) — an Admin can
 * customize a school's copy afterward via `PATCH /notification-templates/:key`.
 * `{{variable}}` markers are interpolated by `NotificationService.notify`.
 *
 * REPORT_CARD_PUBLISHED/INVOICE_OVERDUE/PASSWORD_RESET are `isCritical` —
 * FR8.6's own named examples of notification types that can't be muted via
 * NotificationPreference. PASSWORD_RESET is EMAIL-only — there's no
 * logged-in session to push an in-app notification to before a reset.
 */
export const DEFAULT_NOTIFICATION_TEMPLATES: DefaultNotificationTemplate[] = [
  {
    key: "REPORT_CARD_PUBLISHED",
    channel: "BOTH",
    subject: "Report card published",
    bodyTemplate: "{{studentName}}'s {{termName}} report card is now available.",
    isCritical: true,
  },
  {
    key: "INVOICE_OVERDUE",
    channel: "BOTH",
    subject: "Invoice overdue",
    bodyTemplate: "{{studentName}}'s invoice is overdue. Outstanding balance: {{outstandingAmount}}.",
    isCritical: true,
  },
  {
    key: "PASSWORD_RESET",
    channel: "EMAIL",
    subject: "Reset your password",
    bodyTemplate:
      "Use the link below to reset your password. This link expires shortly.\n{{resetUrl}}",
    isCritical: true,
  },
  {
    key: "INVITATION_RECEIVED",
    channel: "EMAIL",
    subject: "You've been invited to {{schoolName}}",
    bodyTemplate: "{{inviterName}} has invited you to join {{schoolName}} as {{invitedRole}}.",
    isCritical: false,
  },
  {
    key: "PAYMENT_RECEIVED",
    channel: "BOTH",
    subject: "Payment received",
    bodyTemplate: "We received a payment of {{amount}} for {{studentName}}'s invoice.",
    isCritical: false,
  },
  {
    key: "DISCOUNT_REQUEST_APPROVED",
    channel: "IN_APP",
    subject: "Discount request approved",
    bodyTemplate: "The discount request for {{studentName}}'s invoice was approved.",
    isCritical: false,
  },
  {
    key: "DISCOUNT_REQUEST_REJECTED",
    channel: "IN_APP",
    subject: "Discount request rejected",
    bodyTemplate: "The discount request for {{studentName}}'s invoice was rejected: {{reason}}.",
    isCritical: false,
  },
  {
    key: "MANUAL_PAYMENT_APPROVED",
    channel: "BOTH",
    subject: "Bank transfer payment approved",
    bodyTemplate: "The manual bank-transfer payment of {{amount}} for {{studentName}}'s invoice was approved.",
    isCritical: false,
  },
  {
    key: "MANUAL_PAYMENT_REJECTED",
    channel: "BOTH",
    subject: "Bank transfer payment rejected",
    bodyTemplate:
      "The manual bank-transfer payment of {{amount}} for {{studentName}}'s invoice was rejected: {{reason}}.",
    isCritical: false,
  },
  {
    key: "SCHEDULE_GENERATION_COMPLETED",
    channel: "BOTH",
    subject: "Draft schedule ready to review",
    bodyTemplate: "A draft {{scope}} schedule has finished generating and is ready for your review.",
    isCritical: false,
  },
  {
    key: "SCHEDULE_GENERATION_TIMED_OUT",
    channel: "BOTH",
    subject: "Schedule generation failed",
    bodyTemplate: "The {{scope}} generation you requested did not complete in time and can be retried.",
    isCritical: false,
  },
  {
    key: "SCHEDULE_GENERATION_FAILED",
    channel: "BOTH",
    subject: "Schedule generation failed",
    bodyTemplate: "The {{scope}} generation you requested failed: {{errorMessage}}.",
    isCritical: false,
  },
];

/**
 * Shared between apps/api's NotificationService and apps/worker's
 * WorkerNotificationService (the invoice-overdue sweep needs its own notify
 * path — NotificationService lives in apps/api, which worker can't inject
 * across the process boundary) — pure and framework-free, safe for this
 * barrel unlike ./payment-gateways.
 */
export function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(vars[key] ?? ""));
}
