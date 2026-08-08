"use client";

import { useState } from "react";
import { useCurrentUser } from "../../lib/use-current-user";
import { AppShell } from "../../components/templates/app-shell";
import { Letterhead } from "../../components/molecules/letterhead";
import { Card, CardHeader } from "../../components/molecules/card";
import { FeeStructureManager } from "../../components/organisms/fee-structure-manager";
import { GenerateInvoicesForm } from "../../components/organisms/generate-invoices-form";
import { InvoiceList } from "../../components/organisms/invoice-list";
import { InvoiceDetail } from "../../components/organisms/invoice-detail";
import { PendingApprovalsQueue } from "../../components/organisms/pending-approvals-queue";
import { PaymentGatewayConfigList } from "../../components/organisms/payment-gateway-config-list";
import { PaymentLedger } from "../../components/organisms/payment-ledger";

export default function FeesPage() {
  const { user, loading, logout } = useCurrentUser();
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted">Loading…</p>
      </main>
    );
  }
  if (!user) return null;

  // PRD §5: the fees domain is Bursar/Super-Admin only — deliberately NOT
  // the generic isAdmin helper other pages use, since a plain Admin has zero
  // visibility into Fees.
  const canManageFees = user.roles.includes("SUPER_ADMIN") || user.assignmentTypes.includes("BURSAR");
  const isParent = user.roles.includes("PARENT");
  // Narrower than canManageFees — approve/reject is Super-Admin only (a
  // manual role check on the backend, not a CASL grant Bursar also has).
  const isSuperAdmin = user.roles.includes("SUPER_ADMIN");

  if (!canManageFees && !isParent) {
    return (
      <AppShell user={user} onLogout={logout}>
        <Letterhead eyebrow="Operations · Fees" title="Fees" />
        <Card>
          <p className="text-sm text-muted">You have no access to the fees domain.</p>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell user={user} onLogout={logout}>
      <Letterhead eyebrow="Operations · Fees" title="Fees" />

      {canManageFees && (
        <div className="mb-4 grid gap-4 [&>*]:min-w-0 lg:grid-cols-2">
          <Card>
            <CardHeader title="Generate invoices" sub="One invoice per active student in scope" />
            <GenerateInvoicesForm onGenerated={() => setRefreshKey((k) => k + 1)} />
          </Card>
          <Card>
            <CardHeader title="Fee structures" />
            <FeeStructureManager />
          </Card>
        </div>
      )}

      {isSuperAdmin && (
        <Card className="mb-4">
          <CardHeader title="Pending approvals" sub="Manual bank-transfer payments and discount requests awaiting review" />
          <PendingApprovalsQueue />
        </Card>
      )}

      {canManageFees && (
        <Card className="mb-4">
          <CardHeader title="Payment gateway" sub="Read-only — credentials are set via env var + redeploy" />
          <PaymentGatewayConfigList />
        </Card>
      )}

      <div className="mb-4 grid gap-4 [&>*]:min-w-0 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Invoices" sub={canManageFees ? "School-wide" : "Your children"} />
          <InvoiceList canManageFees={canManageFees} refreshKey={refreshKey} onSelect={setSelectedInvoiceId} />
        </Card>
        {selectedInvoiceId && (
          <Card>
            <CardHeader title="Invoice detail" />
            <InvoiceDetail invoiceId={selectedInvoiceId} isParent={isParent} canManageFees={canManageFees} />
          </Card>
        )}
      </div>

      <Card>
        <CardHeader title="Payment history" sub={canManageFees ? "School-wide" : "Your children"} />
        <PaymentLedger canManageFees={canManageFees} />
      </Card>
    </AppShell>
  );
}
