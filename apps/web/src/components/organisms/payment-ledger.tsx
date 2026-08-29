"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { formatCurrency } from "../../lib/currency";
import { Badge, type BadgeVariant } from "../atoms/badge";
import { Button } from "../atoms/button";
import { Label } from "../atoms/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";

type PaymentMethod = "CASH" | "GATEWAY_CARD" | "GATEWAY_TRANSFER" | "GATEWAY_USSD" | "GATEWAY_RESERVED_ACCOUNT" | "BANK_TRANSFER_MANUAL";
type PaymentStatus = "PENDING" | "PENDING_APPROVAL" | "SUCCESSFUL" | "FAILED" | "REVERSED" | "REJECTED";
interface LedgerPaymentItem {
  id: string;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  createdAt: string;
  invoice: { student: { admissionNumber: string; user: { firstName: string; lastName: string } } };
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
const ALL_STATUSES = "__all__";
const PAGE_SIZE = 20;

/**
 * The one genuinely paginated list in Fees — a school-wide ledger is the
 * only list here that can grow large over time (everything else, invoices/
 * fee-structures/discount-requests, is bounded per term and flat-fetched).
 * Bursar/Super-Admin get a status filter + Prev/Next; a parent's own scope
 * stays small (same reasoning InvoiceList used), so no filters for her.
 */
export function PaymentLedger({ canManageFees }: { canManageFees: boolean }) {
  const [payments, setPayments] = useState<LedgerPaymentItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState(ALL_STATUSES);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ skip: String(page * PAGE_SIZE), take: String(PAGE_SIZE) });
    if (canManageFees && status !== ALL_STATUSES) params.set("status", status);
    apiFetch<{ data: LedgerPaymentItem[]; total: number }>(`/payments?${params.toString()}`, { auth: true })
      .then((result) => {
        setPayments(result.data);
        setTotal(result.total);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load payment history"));
  }, [canManageFees, status, page]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!payments) return <p className="text-sm text-muted">Loading…</p>;

  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-3">
      {canManageFees && (
        <div className="max-w-xs">
          <Label htmlFor="ledger-status">Status</Label>
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              setPage(0);
            }}
          >
            <SelectTrigger id="ledger-status" className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_STATUSES}>All statuses</SelectItem>
              {(Object.keys(STATUS_VARIANT) as PaymentStatus[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-muted">
              {canManageFees && <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Student</th>}
              <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Method</th>
              <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Amount</th>
              <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Status</th>
              <th className="py-2 text-[10px] font-medium uppercase tracking-wide">Date</th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 && (
              <tr>
                <td colSpan={canManageFees ? 5 : 4} className="py-3 text-muted">
                  No payments to show.
                </td>
              </tr>
            )}
            {payments.map((payment) => (
              <tr key={payment.id} className="border-b border-border/60 last:border-none">
                {canManageFees && (
                  <td className="py-2.5 pr-4 font-medium">
                    {payment.invoice.student.user.firstName} {payment.invoice.student.user.lastName}{" "}
                    <span className="font-mono text-muted">({payment.invoice.student.admissionNumber})</span>
                  </td>
                )}
                <td className="py-2.5 pr-4">{METHOD_LABEL[payment.method]}</td>
                <td className="py-2.5 pr-4 font-mono">{formatCurrency(payment.amount)}</td>
                <td className="py-2.5 pr-4">
                  <Badge variant={STATUS_VARIANT[payment.status]}>{payment.status}</Badge>
                </td>
                <td className="py-2.5 font-mono text-muted">{payment.createdAt.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-[12px] text-muted">
        <span>
          {total === 0 ? "No payments" : `Showing ${from}–${to} of ${total}`}
        </span>
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Prev
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={to >= total} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
