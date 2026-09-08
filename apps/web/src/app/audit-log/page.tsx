"use client";

import { useCurrentUser } from "../../lib/use-current-user";
import { AppShell } from "../../components/templates/app-shell";
import { PageLoadingSkeleton } from "../../components/templates/page-loading-skeleton";
import { Letterhead } from "../../components/molecules/letterhead";
import { Card } from "../../components/molecules/card";
import { AuditLogList } from "../../components/organisms/audit-log-list";

export default function AuditLogPage() {
  const { user, loading, logout } = useCurrentUser();

  if (loading) {
    return <PageLoadingSkeleton />;
  }
  if (!user) return null;

  // Super-Admin only — matches the backend CASL check (ability.factory.ts's
  // "read AuditLog", only reachable via SUPER_ADMIN's "manage all").
  const canView = user.roles.includes("SUPER_ADMIN");

  if (!canView) {
    return (
      <AppShell user={user} onLogout={logout}>
        <Letterhead eyebrow="Settings" title="Audit log" />
        <Card>
          <p className="text-sm text-muted">You don&apos;t have permission to view the audit log.</p>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell user={user} onLogout={logout}>
      <Letterhead eyebrow="Settings · Audit Log" title="Who changed what" />
      <Card>
        <AuditLogList />
      </Card>
    </AppShell>
  );
}
