"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api";
import { formatCurrency } from "../../lib/currency";
import type { CurrentUser } from "../../lib/use-current-user";
import { useCurrentTerm } from "../../lib/use-current-term";
import { Card, CardHeader } from "../molecules/card";
import { DonutChart, BarChart } from "../molecules/chart";
import { StatCard } from "../atoms/stat-card";
import { Badge } from "../atoms/badge";

interface FinanceOverview {
  outstandingSchoolWide: number;
  outstandingTrendVsLastTerm: number | null;
  outstandingByClass: { classArmId: string; className: string; outstanding: number }[];
  invoicesByStatus: Record<"UNPAID" | "PARTIAL" | "PAID" | "OVERDUE", number>;
  reconciliationStuckCount: number;
}
interface PaymentItem {
  id: string;
  amount: number;
  status: string;
  createdAt: string;
  proofOfPaymentUrl: string | null;
  receipt: { receiptNumber: string; issuedAt: string } | null;
  invoice: { student: { admissionNumber: string; user: { firstName: string; lastName: string } } };
}
interface DiscountRequestItem {
  id: string;
  type: "PERCENTAGE" | "FIXED_AMOUNT";
  value: number;
  status: string;
  createdAt: string;
  invoice: { student: { admissionNumber: string; user: { firstName: string; lastName: string } } };
}

/**
 * PRD FR9.7 Bursar dashboard. Deliberately does NOT reuse
 * PendingApprovalsQueue (unlike Super-Admin's dashboard) — that component's
 * Approve/Reject buttons hit endpoints that are Super-Admin-only carve-outs
 * in the controller (PaymentController.approveManualBankTransfer/
 * DiscountRequestController.approve, manual role checks, not just "manage
 * Payment"/"manage DiscountRequest" CASL grants a Bursar also holds), so a
 * Bursar clicking them would just get a 403 — these render read-only.
 */
export function BursarDashboard({ user }: { user: CurrentUser }) {
  const { termId } = useCurrentTerm();

  const isBursar = user.assignmentTypes.includes("BURSAR");

  const { data: finance } = useQuery({
    queryKey: ["dashboard", "finance-overview", termId],
    queryFn: () => apiFetch<FinanceOverview>(`/dashboard/finance-overview?termId=${termId}`, { auth: true }),
    enabled: Boolean(termId) && isBursar,
  });
  const { data: pendingPayments } = useQuery({
    queryKey: ["payments", { status: "PENDING_APPROVAL" }],
    queryFn: () => apiFetch<PaymentItem[]>("/payments?status=PENDING_APPROVAL", { auth: true }),
    enabled: isBursar,
  });
  const { data: discountRequests } = useQuery({
    queryKey: ["discount-requests", { status: "PENDING" }],
    queryFn: () => apiFetch<DiscountRequestItem[]>("/discount-requests?status=PENDING", { auth: true }),
    enabled: isBursar,
  });
  const { data: recentReceiptsResult } = useQuery({
    queryKey: ["payments", { status: "SUCCESSFUL", take: 10 }],
    queryFn: () => apiFetch<{ data: PaymentItem[]; total: number }>("/payments?status=SUCCESSFUL&take=10", { auth: true }),
    enabled: isBursar,
  });
  const recentReceipts = recentReceiptsResult?.data ?? null;

  if (!isBursar) return null;

  return (
    <div className="mt-4 space-y-4">
      <Card>
        <CardHeader title="Finance overview" sub="School-wide fees position" />
        {finance ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <StatCard
                label="Outstanding balance"
                value={formatCurrency(finance.outstandingSchoolWide)}
                trend={
                  finance.outstandingTrendVsLastTerm === null
                    ? undefined
                    : {
                        direction: finance.outstandingTrendVsLastTerm >= 0 ? "up" : "down",
                        label: `${formatCurrency(Math.abs(finance.outstandingTrendVsLastTerm))} vs last term`,
                        tone: finance.outstandingTrendVsLastTerm >= 0 ? "negative" : "positive",
                      }
                }
              />
              <StatCard
                label="Gateway reconciliation health"
                value={finance.reconciliationStuckCount}
                tone={finance.reconciliationStuckCount > 0 ? "warning" : "default"}
                sub="Payments stuck > 15 min"
              />
            </div>
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">Invoices generated vs. paid</div>
              <DonutChart data={Object.entries(finance.invoicesByStatus).map(([label, value]) => ({ label, value }))} height={140} />
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">Loading…</p>
        )}
      </Card>

      <Card>
        <CardHeader title="Outstanding balance by class" />
        {finance ? (
          <BarChart
            data={finance.outstandingByClass.map((c) => ({ className: c.className, outstanding: c.outstanding }))}
            xKey="className"
            yKey="outstanding"
            height={220}
          />
        ) : (
          <p className="text-sm text-muted">Loading…</p>
        )}
      </Card>

      <Card>
        <CardHeader title="Pending manual payments" sub="Submitted, awaiting Super-Admin review" />
        {pendingPayments ? (
          pendingPayments.length === 0 ? (
            <p className="text-sm text-muted">Nothing pending.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                    <th className="pb-1.5 pr-3">Student</th>
                    <th className="pb-1.5 pr-3">Amount</th>
                    <th className="pb-1.5 pr-3">Submitted</th>
                    <th className="pb-1.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingPayments.map((p) => (
                    <tr key={p.id} className="border-t border-border">
                      <td className="py-1.5 pr-3">
                        {p.invoice.student.user.firstName} {p.invoice.student.user.lastName}
                      </td>
                      <td className="py-1.5 pr-3 font-mono">{formatCurrency(p.amount)}</td>
                      <td className="py-1.5 pr-3 font-mono text-muted">{new Date(p.createdAt).toLocaleDateString()}</td>
                      <td className="py-1.5">
                        <Badge variant="warning">{p.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <p className="text-sm text-muted">Loading…</p>
        )}
      </Card>

      <Card>
        <CardHeader title="Discount requests raised" sub="Awaiting Super-Admin review" />
        {discountRequests ? (
          discountRequests.length === 0 ? (
            <p className="text-sm text-muted">Nothing pending.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                    <th className="pb-1.5 pr-3">Student</th>
                    <th className="pb-1.5 pr-3">Amount</th>
                    <th className="pb-1.5 pr-3">Status</th>
                    <th className="pb-1.5">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {discountRequests.map((d) => (
                    <tr key={d.id} className="border-t border-border">
                      <td className="py-1.5 pr-3">
                        {d.invoice.student.user.firstName} {d.invoice.student.user.lastName}
                      </td>
                      <td className="py-1.5 pr-3 font-mono">
                        {d.type === "PERCENTAGE" ? `${d.value}%` : formatCurrency(d.value)}
                      </td>
                      <td className="py-1.5 pr-3">
                        <Badge variant="warning">{d.status}</Badge>
                      </td>
                      <td className="py-1.5 font-mono text-muted">{new Date(d.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <p className="text-sm text-muted">Loading…</p>
        )}
      </Card>

      <Card>
        <CardHeader title="Recent receipts issued" sub="Most recent 10" />
        {recentReceipts ? (
          recentReceipts.length === 0 ? (
            <p className="text-sm text-muted">No receipts yet.</p>
          ) : (
            <ul className="max-h-[280px] space-y-1.5 overflow-y-auto text-[12.5px]">
              {recentReceipts.map((p) => (
                <li key={p.id} className="flex items-center justify-between rounded-lg border border-border p-2.5">
                  <span>
                    {p.invoice.student.user.firstName} {p.invoice.student.user.lastName}{" "}
                    <span className="font-mono text-muted">{p.receipt?.receiptNumber ?? "—"}</span>
                  </span>
                  <span className="font-mono">{formatCurrency(p.amount)}</span>
                </li>
              ))}
            </ul>
          )
        ) : (
          <p className="text-sm text-muted">Loading…</p>
        )}
      </Card>
    </div>
  );
}
