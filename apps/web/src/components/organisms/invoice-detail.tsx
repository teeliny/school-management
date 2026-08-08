"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { formatCurrency } from "../../lib/currency";
import { Badge, type BadgeVariant } from "../atoms/badge";
import { Button } from "../atoms/button";
import { InvoicePaymentsList } from "./invoice-payments-list";
import { RecordPaymentForm } from "./record-payment-form";

type InvoiceStatus = "UNPAID" | "PARTIAL" | "PAID" | "OVERDUE";
interface InvoiceLineItem {
  id: string;
  type: "FEE" | "DISCOUNT";
  amount: number;
  description: string;
}
interface InvoiceDetailData {
  id: string;
  status: InvoiceStatus;
  dueDate: string;
  totalAmount: number;
  outstandingBalance: number;
  lineItems: InvoiceLineItem[];
  student: { admissionNumber: string; user: { firstName: string; lastName: string } };
  term: { name: string };
}

const STATUS_VARIANT: Record<InvoiceStatus, BadgeVariant> = {
  UNPAID: "muted",
  PARTIAL: "warning",
  PAID: "success",
  OVERDUE: "danger",
};

/**
 * "Pay online" is only ever shown to a PARENT — the backend already scopes
 * `GET /invoices/:id` so a parent can only ever land here on her own ward's
 * invoice, so no extra guardian check is needed client-side beyond the role
 * check. Bursar/Super-Admin get `RecordPaymentForm` instead (cash/manual-
 * transfer recording) — the two are mutually exclusive per viewer.
 */
export function InvoiceDetail({
  invoiceId,
  isParent,
  canManageFees,
}: {
  invoiceId: string;
  isParent: boolean;
  canManageFees: boolean;
}) {
  const [invoice, setInvoice] = useState<InvoiceDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payingUp, setPayingUp] = useState(false);
  const [paymentsRefreshKey, setPaymentsRefreshKey] = useState(0);

  const load = useCallback(() => {
    setError(null);
    apiFetch<InvoiceDetailData>(`/invoices/${invoiceId}`, { auth: true })
      .then(setInvoice)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load invoice"));
  }, [invoiceId]);

  useEffect(() => {
    setInvoice(null);
    load();
  }, [invoiceId, load]);

  async function handlePayOnline() {
    setError(null);
    setPayingUp(true);
    try {
      const { checkoutUrl } = await apiFetch<{ checkoutUrl: string }>("/payments/gateway-checkout", {
        method: "POST",
        auth: true,
        body: { invoiceId },
      });
      // No apps/api change needed for /payments/complete to know which
      // invoice to show: stash it here, read it back on the return trip.
      sessionStorage.setItem("pendingInvoiceId", invoiceId);
      window.location.href = checkoutUrl;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to start checkout");
      setPayingUp(false);
    }
  }

  function handleRecorded() {
    load();
    setPaymentsRefreshKey((k) => k + 1);
  }

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!invoice) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">
            {invoice.student.user.firstName} {invoice.student.user.lastName}{" "}
            <span className="font-mono text-muted">({invoice.student.admissionNumber})</span>
          </p>
          <p className="text-[12px] text-muted">
            {invoice.term.name} · due {invoice.dueDate.slice(0, 10)}
          </p>
        </div>
        <Badge variant={STATUS_VARIANT[invoice.status]}>{invoice.status}</Badge>
      </div>

      <table className="w-full text-left text-[12.5px]">
        <thead>
          <tr className="border-b border-border text-muted">
            <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Line item</th>
            <th className="py-2 text-[10px] font-medium uppercase tracking-wide">Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lineItems.map((line) => (
            <tr key={line.id} className="border-b border-border/60 last:border-none">
              <td className="py-2 pr-4">{line.description}</td>
              <td className={`py-2 font-mono ${line.type === "DISCOUNT" ? "text-success" : ""}`}>
                {formatCurrency(line.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="space-y-1 border-t border-border pt-3 text-[12.5px]">
        <div className="flex items-center justify-between">
          <span className="text-muted">Total</span>
          <span className="font-mono">{formatCurrency(invoice.totalAmount)}</span>
        </div>
        <div className="flex items-center justify-between font-medium">
          <span>Outstanding balance</span>
          <span className="font-mono">{formatCurrency(invoice.outstandingBalance)}</span>
        </div>
      </div>

      {isParent && invoice.outstandingBalance > 0 && (
        <Button type="button" disabled={payingUp} onClick={handlePayOnline}>
          {payingUp ? "Redirecting…" : "Pay online"}
        </Button>
      )}

      {canManageFees && invoice.outstandingBalance > 0 && (
        <RecordPaymentForm invoiceId={invoiceId} outstandingBalance={invoice.outstandingBalance} onRecorded={handleRecorded} />
      )}

      <div className="border-t border-border pt-3">
        <p className="mb-2 text-[12px] font-medium uppercase tracking-wide text-muted">Payments</p>
        <InvoicePaymentsList invoiceId={invoiceId} refreshKey={paymentsRefreshKey} />
      </div>
    </div>
  );
}
