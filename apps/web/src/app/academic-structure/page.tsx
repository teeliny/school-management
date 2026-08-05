"use client";

import { useCurrentUser } from "../../lib/use-current-user";
import { AppShell } from "../../components/templates/app-shell";
import { Letterhead } from "../../components/molecules/letterhead";
import { Card } from "../../components/molecules/card";
import { CollapsibleCard } from "../../components/molecules/collapsible-card";
import { AcademicSessionManager } from "../../components/organisms/academic-session-manager";
import { TermManager } from "../../components/organisms/term-manager";
import { ClassLevelManager } from "../../components/organisms/class-level-manager";
import { ClassArmManager } from "../../components/organisms/class-arm-manager";
import { DepartmentManager } from "../../components/organisms/department-manager";

export default function AcademicStructurePage() {
  const { user, loading, logout } = useCurrentUser();

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted">Loading…</p>
      </main>
    );
  }
  if (!user) return null;

  const canManage = user.roles.includes("SUPER_ADMIN") || user.roles.includes("ADMIN");

  if (!canManage) {
    return (
      <AppShell user={user} onLogout={logout}>
        <Letterhead eyebrow="Academics · Structure" title="Academic structure" />
        <Card>
          <p className="text-sm text-muted">You don&apos;t have permission to manage academic structure.</p>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell user={user} onLogout={logout}>
      <Letterhead eyebrow="Academics · Structure" title="Academic structure" />

      <div className="space-y-4">
        <CollapsibleCard title="Academic sessions" sub="Exactly one is current at a time (PRD §3.2)">
          <AcademicSessionManager />
        </CollapsibleCard>

        <CollapsibleCard
          title="Terms"
          sub="One current term per session — required for compulsory subject auto-enrollment"
        >
          <TermManager />
        </CollapsibleCard>

        <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-2">
          <CollapsibleCard title="Class levels">
            <ClassLevelManager />
          </CollapsibleCard>
          <CollapsibleCard title="Departments" sub="SSS-only (PRD §3.2)">
            <DepartmentManager />
          </CollapsibleCard>
        </div>

        <CollapsibleCard title="Class arms">
          <ClassArmManager />
        </CollapsibleCard>
      </div>
    </AppShell>
  );
}
