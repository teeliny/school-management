"use client";

import { Fragment, useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { apiFetch, ApiError } from "../../lib/api";
import { formatCurrency } from "../../lib/currency";
import { Badge, type BadgeVariant } from "../atoms/badge";
import { Button } from "../atoms/button";
import { Input } from "../atoms/input";
import { SkeletonTable } from "../molecules/skeleton-table";
import { EmptyState } from "../molecules/empty-state";

type PaymentMethod = "CASH" | "GATEWAY_CARD" | "GATEWAY_TRANSFER" | "GATEWAY_USSD" | "GATEWAY_RESERVED_ACCOUNT" | "BANK_TRANSFER_MANUAL";
type PaymentStatus = "PENDING" | "PENDING_APPROVAL" | "SUCCESSFUL" | "FAILED" | "REVERSED" | "REJECTED";
interface PaymentItem {
  id: string;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  createdAt: string;
  proofOfPaymentUrl: string | null;
  receipt: { receiptNumber: string; pdfUrl: string | null } | null;
}

const STATUS_VARIANT: Record<PaymentStatus, BadgeVariant> = {
  SUCCESSFUL: "success",
  PENDING: "warning",
  PENDING_APPROVAL: "warning",
  FAILED: "danger",
  REJECTED: "danger",
  REVERSED: "muted",
};
const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: "Cash",
  GATEWAY_CARD: "Card",
  GATEWAY_TRANSFER: "Bank transfer (gateway)",
  GATEWAY_USSD: "USSD",
  GATEWAY_RESERVED_ACCOUNT: "Reserved account",
  BANK_TRANSFER_MANUAL: "Bank transfer (manual)",
};

/**
 * GET /payments?invoiceId= — full Payment shape including `receipt`, unlike
 * `invoice.payments` from GET /invoices/:id (flat, no nested receipt).
 *
 * `isSuperAdmin` gates the "Reverse" action (PATCH /payments/:id/reverse) —
 * Super-Admin only, same manual role-check pattern as approve/reject, so a
 * Bursar can't erase her own mis-keyed amount unreviewed. Only offered for
 * CASH/BANK_TRANSFER_MANUAL — a gateway payment's amount is verified by the
 * provider, not staff-entered, so there's nothing to correct (backend
 * rejects it too; this is just the matching client-side gate). Reversing
 * never edits the payment in place; it marks it REVERSED and the Bursar records a
 * fresh, correct-amount payment separately via RecordPaymentForm.
 */
export function InvoicePaymentsList({
  invoiceId,
  refreshKey,
  isSuperAdmin,
  onReversed,
}: {
  invoiceId: string;
  refreshKey?: unknown;
  isSuperAdmin?: boolean;
  onReversed?: () => void;
}) {
  const [payments, setPayments] = useState<PaymentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reversingId, setReversingId] = useState<string | null>(null);
  const [reversalReason, setReversalReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiFetch<PaymentItem[]>(`/payments?invoiceId=${invoiceId}`, { auth: true })
      .then(setPayments)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load payments"));
  }, [invoiceId, refreshKey]);

  async function handleReverse(paymentId: string) {
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch(`/payments/${paymentId}/reverse`, { method: "PATCH", auth: true, body: { reason: reversalReason } });
      setReversingId(null);
      setReversalReason("");
      onReversed?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to reverse payment");
    } finally {
      setSubmitting(false);
    }
  }

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!payments) return <SkeletonTable rows={2} columns={5} />;
  if (payments.length === 0) return <EmptyState icon={Wallet} title="No payments recorded against this invoice yet" />;

  return (
    <table className="w-full text-left text-[12.5px]">
      <thead>
        <tr className="border-b border-border text-muted">
          <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Method</th>
          <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Amount</th>
          <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Status</th>
          <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Date</th>
          <th className="py-2 text-[10px] font-medium uppercase tracking-wide">Links</th>
        </tr>
      </thead>
      <tbody>
        {payments.map((payment) => (
          <Fragment key={payment.id}>
            <tr className="border-b border-border/60 last:border-none even:bg-card-inset">
              <td className="py-2.5 pr-4">{METHOD_LABEL[payment.method]}</td>
              <td className="py-2.5 pr-4 font-mono">{formatCurrency(payment.amount)}</td>
              <td className="py-2.5 pr-4">
                <Badge variant={STATUS_VARIANT[payment.status]}>{payment.status}</Badge>
              </td>
              <td className="py-2.5 pr-4 font-mono text-muted">{payment.createdAt.slice(0, 10)}</td>
              <td className="py-2.5 space-x-2">
                {payment.proofOfPaymentUrl && (
                  <a href={payment.proofOfPaymentUrl} target="_blank" rel="noreferrer" className="text-primary underline">
                    View proof
                  </a>
                )}
                {payment.receipt?.pdfUrl && (
                  <a href={payment.receipt.pdfUrl} target="_blank" rel="noreferrer" className="text-primary underline">
                    Receipt
                  </a>
                )}
                {payment.receipt && !payment.receipt.pdfUrl && <span className="text-muted">Receipt generating…</span>}
                {isSuperAdmin && payment.status === "SUCCESSFUL" && (payment.method === "CASH" || payment.method === "BANK_TRANSFER_MANUAL") && (
                  <button
                    type="button"
                    className="text-danger underline"
                    onClick={() => {
                      setReversingId(reversingId === payment.id ? null : payment.id);
                      setReversalReason("");
                    }}
                  >
                    Reverse
                  </button>
                )}
              </td>
            </tr>
            {reversingId === payment.id && (
              <tr className="border-b border-border/60 last:border-none">
                <td colSpan={5} className="py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      placeholder="Reason for reversal (e.g. wrong amount recorded)"
                      value={reversalReason}
                      onChange={(e) => setReversalReason(e.target.value)}
                      className="max-w-xs"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!reversalReason.trim() || submitting}
                      onClick={() => handleReverse(payment.id)}
                    >
                      {submitting ? "Reversing…" : "Confirm reverse"}
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setReversingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </td>
              </tr>
            )}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}
