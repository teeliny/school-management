"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { formatCurrency } from "../../lib/currency";
import { Badge, type BadgeVariant } from "../atoms/badge";

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

/** GET /payments?invoiceId= — full Payment shape including `receipt`, unlike `invoice.payments` from GET /invoices/:id (flat, no nested receipt). */
export function InvoicePaymentsList({ invoiceId, refreshKey }: { invoiceId: string; refreshKey?: unknown }) {
  const [payments, setPayments] = useState<PaymentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<PaymentItem[]>(`/payments?invoiceId=${invoiceId}`, { auth: true })
      .then(setPayments)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load payments"));
  }, [invoiceId, refreshKey]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!payments) return <p className="text-sm text-muted">Loading…</p>;
  if (payments.length === 0) return <p className="text-sm text-muted">No payments recorded against this invoice yet.</p>;

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
          <tr key={payment.id} className="border-b border-border/60 last:border-none">
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
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
