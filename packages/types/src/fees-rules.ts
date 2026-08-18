/**
 * Mirrors the Prisma `InvoiceStatus` enum (prisma/schema.prisma).
 */
export type InvoiceStatus = "UNPAID" | "PARTIAL" | "PAID" | "OVERDUE";

/**
 * PRD §3.9: an Invoice's outstanding balance is deliberately never stored —
 * always computed live from totalAmount, its InvoiceLineItems (DISCOUNT
 * amounts already negative), and its SUCCESSFUL Payments. Pure and
 * framework-free so every write path that can change one of those three
 * inputs (this slice's CASH recording, and later the gateway webhook,
 * manual-transfer approval, and discount approval) applies exactly the same
 * formula rather than each re-deriving it — same precedent as
 * `isStructureComplete`/`computeSchoolDaysOpened` above.
 */
export function computeOutstandingBalance(
  totalAmount: number,
  lineItemAmounts: number[],
  successfulPaymentAmounts: number[],
): number {
  const lineItemSum = lineItemAmounts.reduce((sum, amount) => sum + amount, 0);
  const paidSum = successfulPaymentAmounts.reduce((sum, amount) => sum + amount, 0);
  return totalAmount + lineItemSum - paidSum;
}

/**
 * PRD §3.9: `Invoice.status` is a stored, indexed column (list-filtering
 * performance) but always recomputed from the same inputs as
 * `computeOutstandingBalance`, in the same transaction as whatever wrote a
 * Payment/DiscountRequest against the invoice — never hand-set
 * independently.
 *
 * OVERDUE takes priority over PARTIAL when both are true (an outstanding
 * balance remains past the due date, even after a partial payment) — a
 * Bursar filtering "which invoices are overdue" needs a partially-paid-but-
 * still-late invoice to show up there, not be hidden under PARTIAL.
 */
export function computeInvoiceStatus(
  outstandingBalance: number,
  paidTotal: number,
  dueDate: Date,
  now: Date,
): InvoiceStatus {
  if (outstandingBalance <= 0) return "PAID";
  if (now.getTime() > dueDate.getTime()) return "OVERDUE";
  if (paidTotal > 0) return "PARTIAL";
  return "UNPAID";
}
