"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCurrentUser } from "../../lib/use-current-user";
import { AppShell } from "../../components/templates/app-shell";
import { PageLoadingSkeleton } from "../../components/templates/page-loading-skeleton";
import { Letterhead } from "../../components/molecules/letterhead";
import { Card, CardHeader } from "../../components/molecules/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/molecules/tabs";
import { FeeStructureManager } from "../../components/organisms/fee-structure-manager";
import { GenerateInvoicesForm } from "../../components/organisms/generate-invoices-form";
import { InvoiceList } from "../../components/organisms/invoice-list";
import { InvoiceDetail } from "../../components/organisms/invoice-detail";
import { PendingApprovalsQueue } from "../../components/organisms/pending-approvals-queue";
import { PaymentGatewayConfigList } from "../../components/organisms/payment-gateway-config-list";
import { PaymentLedger } from "../../components/organisms/payment-ledger";
import { OutstandingBalancesList } from "../../components/organisms/outstanding-balances-list";

type TabKey = "generate" | "structures" | "approvals" | "gateway" | "invoices" | "history" | "balances";
const TAB_KEYS: TabKey[] = ["generate", "structures", "approvals", "gateway", "invoices", "history", "balances"];
const TAB_LABEL: Record<TabKey, string> = {
  generate: "Generate Invoices",
  structures: "Fee Structures",
  approvals: "Pending Approvals",
  gateway: "Payment Gateway",
  invoices: "Invoices",
  history: "Payment History",
  balances: "Outstanding Balances",
};

// Shared between the rendered TabsList and the default-tab computation below
// so the two can never disagree — a hardcoded default that isn't actually in
// this list (e.g. "generate" for a Parent, who never gets that tab) leaves
// Radix's controlled Tabs with a value matching no trigger: nothing selected,
// no content shown.
function visibleTabKeys(canManageFees: boolean, isSuperAdmin: boolean, isParent: boolean, canViewOutstandingBalances: boolean): TabKey[] {
  return TAB_KEYS.filter(
    (key) =>
      (!["generate", "structures", "gateway"].includes(key) || canManageFees) &&
      (key !== "approvals" || isSuperAdmin) &&
      (!["invoices", "history"].includes(key) || canManageFees || isParent) &&
      (key !== "balances" || canViewOutstandingBalances),
  );
}

export default function FeesPage() {
  return (
    <Suspense fallback={null}>
      <FeesPageInner />
    </Suspense>
  );
}

function FeesPageInner() {
  const { user, loading, logout } = useCurrentUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  // A student profile's "Fees" quick link arrives as `?studentId=...`,
  // narrowing the invoice list to that one student — same pattern as the
  // report-cards page's own studentId deep link. Since Invoices now lives
  // behind a tab, a bare `?tab=` default would strand that link on whatever
  // tab happens to be first — default straight to the Invoices tab instead
  // whenever studentId is present (an explicit `?tab=` still wins).
  const studentId = searchParams.get("studentId") ?? undefined;
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  // Live counts reported up by InvoiceList/OutstandingBalancesList (their
  // backend-paginated `total`, not just what's scrolled into view yet) —
  // shown in the panel title as "Invoices(N)"/"Outstanding Balances(N)".
  const [invoiceTotal, setInvoiceTotal] = useState(0);
  const [balanceTotal, setBalanceTotal] = useState(0);

  // PRD §5: the fees domain is Bursar/Super-Admin only — deliberately NOT
  // the generic isAdmin helper other pages use, since a plain Admin has zero
  // visibility into Fees beyond the read-only Outstanding Balances carve-out
  // below. Computed with `!!user &&` since these run before the loading/
  // user-null early returns below (hooks must run unconditionally).
  const canManageFees = !!user && (user.roles.includes("SUPER_ADMIN") || user.assignmentTypes.includes("BURSAR"));
  const isParent = !!user && user.roles.includes("PARENT");
  // Narrower than canManageFees — approve/reject is Super-Admin only (a
  // manual role check on the backend, not a CASL grant Bursar also has).
  const isSuperAdmin = !!user && user.roles.includes("SUPER_ADMIN");
  // Read-only exception to "the fees domain is invisible to Admin" — see
  // ability.factory.ts's OutstandingBalanceSummary grants. Principal/VP/
  // Headteacher get the same read-only visibility, scoped server-side to
  // their own section (resolvePrincipalHeadteacherCategories).
  const isPlainAdmin = !!user && user.roles.includes("ADMIN");
  const isPrincipalOrHeadteacher =
    !!user && ["PRINCIPAL", "VICE_PRINCIPAL", "HEADTEACHER"].some((title) => user.assignmentTypes.includes(title));
  const canViewOutstandingBalances = canManageFees || isPlainAdmin || isPrincipalOrHeadteacher;
  // Only Super-Admin/Bursar get the excuse toggle (OutstandingBalanceSummary's
  // "manage" grant) — Admin/Principal/Headteacher are read-only.
  const canExcuse = canManageFees;
  const visibleTabs = visibleTabKeys(canManageFees, isSuperAdmin, isParent, canViewOutstandingBalances);

  const requestedTab = searchParams.get("tab") as TabKey | null;
  const defaultTab: TabKey = studentId && visibleTabs.includes("invoices") ? "invoices" : (visibleTabs[0] ?? "invoices");
  // `tab` only ever holds an explicit user click (via changeTab) — it starts
  // `null` rather than being computed once at mount, because `user` (and
  // therefore `visibleTabs`) isn't available yet on the very first render
  // (useCurrentUser's /auth/me fetch hasn't resolved). A useState initializer
  // only runs once, on that first render, so seeding it from `visibleTabs`
  // directly used to permanently lock `tab` to the "invoices" fallback
  // before the real role-based tabs were known — invisible for Bursar/Super-
  // Admin/Parent (who always have an "invoices" TabsContent to fall back
  // into) but a blank page for Admin/Principal/VP/Headteacher, who don't.
  // `activeTab` is recomputed fresh every render instead, so it always
  // reflects the current `visibleTabs` once `user` loads.
  const [tab, setTab] = useState<TabKey | null>(null);
  const activeTab: TabKey =
    tab && visibleTabs.includes(tab) ? tab : requestedTab && visibleTabs.includes(requestedTab) ? requestedTab : defaultTab;

  if (loading) {
    return <PageLoadingSkeleton />;
  }
  if (!user) return null;

  if (!canManageFees && !isParent && !canViewOutstandingBalances) {
    return (
      <AppShell user={user} onLogout={logout}>
        <Letterhead eyebrow="Operations · Fees" title="Fees" />
        <Card>
          <p className="text-sm text-muted">You have no access to the fees domain.</p>
        </Card>
      </AppShell>
    );
  }

  function changeTab(next: TabKey) {
    setTab(next);
    router.replace(`/fees?tab=${next}`);
  }

  return (
    <AppShell user={user} onLogout={logout}>
      <Letterhead eyebrow="Operations · Fees" title="Fees" />

      <Tabs value={activeTab} onValueChange={(v) => changeTab(v as TabKey)}>
        <TabsList>
          {visibleTabs.map((key) => (
            <TabsTrigger key={key} value={key}>
              {TAB_LABEL[key]}
            </TabsTrigger>
          ))}
        </TabsList>

        {canManageFees && (
          <TabsContent value="generate">
            <Card>
              <CardHeader title="Generate invoices" sub="One invoice per active student in scope" />
              <GenerateInvoicesForm onGenerated={() => setRefreshKey((k) => k + 1)} />
            </Card>
          </TabsContent>
        )}

        {canManageFees && (
          <TabsContent value="structures">
            <Card>
              <CardHeader title="Fee structures" />
              <FeeStructureManager />
            </Card>
          </TabsContent>
        )}

        {isSuperAdmin && (
          <TabsContent value="approvals">
            <Card>
              <CardHeader title="Pending approvals" sub="Manual bank-transfer payments and discount requests awaiting review" />
              <PendingApprovalsQueue />
            </Card>
          </TabsContent>
        )}

        {canManageFees && (
          <TabsContent value="gateway">
            <Card>
              <CardHeader title="Payment gateway" sub="Read-only — credentials are updated via the API, not this UI" />
              <PaymentGatewayConfigList />
            </Card>
          </TabsContent>
        )}

        {(canManageFees || isParent) && (
          <TabsContent value="invoices">
            <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-[1.4fr_1fr]">
              <Card>
                <CardHeader title={`Invoices(${invoiceTotal})`} sub={canManageFees ? "School-wide" : "Your children"} />
                <InvoiceList
                  canManageFees={canManageFees}
                  studentId={studentId}
                  refreshKey={refreshKey}
                  onSelect={setSelectedInvoiceId}
                  onTotalChange={setInvoiceTotal}
                />
              </Card>
              {selectedInvoiceId && (
                <Card>
                  <CardHeader title="Invoice detail" />
                  <InvoiceDetail invoiceId={selectedInvoiceId} isParent={isParent} canManageFees={canManageFees} />
                </Card>
              )}
            </div>
          </TabsContent>
        )}

        {(canManageFees || isParent) && (
          <TabsContent value="history">
            <Card>
              <CardHeader title="Payment history" sub={canManageFees ? "School-wide" : "Your children"} />
              <PaymentLedger canManageFees={canManageFees} />
            </Card>
          </TabsContent>
        )}

        {canViewOutstandingBalances && (
          <TabsContent value="balances">
            <Card>
              <CardHeader
                title={`Outstanding Balances(${balanceTotal})`}
                sub={isPrincipalOrHeadteacher ? "Your section" : "School-wide"}
              />
              <OutstandingBalancesList canExcuse={canExcuse} canFilterBySection={canManageFees} onTotalChange={setBalanceTotal} />
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </AppShell>
  );
}
