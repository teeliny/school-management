"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useCurrentUser } from "../../../lib/use-current-user";
import { apiFetch, ApiError } from "../../../lib/api";
import { formatCurrency } from "../../../lib/currency";
import { AppShell } from "../../../components/templates/app-shell";
import { Letterhead } from "../../../components/molecules/letterhead";
import { Card } from "../../../components/molecules/card";
import { Badge, type BadgeVariant } from "../../../components/atoms/badge";
import { Button } from "../../../components/atoms/button";

type InvoiceStatus = "UNPAID" | "PARTIAL" | "PAID" | "OVERDUE";
interface InvoiceSummary {
  id: string;
  status: InvoiceStatus;
  outstandingBalance: number;
}

const STATUS_VARIANT: Record<InvoiceStatus, BadgeVariant> = {
  UNPAID: "muted",
  PARTIAL: "warning",
  PAID: "success",
  OVERDUE: "danger",
};

/**
 * The gateway's redirectUrl carries no query params (set server-side,
 * apps/api unchanged) — InvoiceDetail's "Pay online" handler stashes the
 * invoice id in sessionStorage right before redirecting here. Confirmation
 * itself happens asynchronously via webhook/reconciliation regardless of
 * whether this page is ever viewed — this is a status check, not the source
 * of truth, hence a manual "Check again" rather than a polling loop.
 */
export default function PaymentsCompletePage() {
  const { user, loading, logout } = useCurrentUser();
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<InvoiceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    setInvoiceId(sessionStorage.getItem("pendingInvoiceId"));
  }, []);

  function checkStatus(id: string) {
    setChecking(true);
    setError(null);
    apiFetch<InvoiceSummary>(`/invoices/${id}`, { auth: true })
      .then(setInvoice)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load invoice"))
      .finally(() => setChecking(false));
  }

  useEffect(() => {
    if (invoiceId) checkStatus(invoiceId);
  }, [invoiceId]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted">Loading…</p>
      </main>
    );
  }
  if (!user) return null;

  return (
    <AppShell user={user} onLogout={logout}>
      <Letterhead eyebrow="Operations · Fees" title="Payment status" />
      <Card>
        {!invoiceId && (
          <p className="text-sm text-muted">
            We couldn&apos;t tell which invoice this was for. Check its current status from the Fees page.
          </p>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        {invoiceId && invoice && (
          <div className="space-y-3">
            <p className="text-sm">
              Thanks — we&apos;re confirming your payment with the gateway. This can take a minute to reflect here.
            </p>
            <div className="flex items-center gap-3 text-[13px]">
              <Badge variant={STATUS_VARIANT[invoice.status]}>{invoice.status}</Badge>
              <span className="font-mono">{formatCurrency(invoice.outstandingBalance)} outstanding</span>
            </div>
            <Button type="button" variant="outline" size="sm" disabled={checking} onClick={() => checkStatus(invoiceId)}>
              {checking ? "Checking…" : "Check again"}
            </Button>
          </div>
        )}
        <Link href="/fees" className="mt-4 inline-block text-[13px] text-primary underline">
          Back to Fees
        </Link>
      </Card>
    </AppShell>
  );
}
