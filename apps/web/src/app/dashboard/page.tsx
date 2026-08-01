"use client";

import Link from "next/link";
import { useCurrentUser } from "../../lib/use-current-user";
import { AppShell } from "../../components/templates/app-shell";
import { Letterhead } from "../../components/molecules/letterhead";
import { Card, CardHeader } from "../../components/molecules/card";

export default function DashboardPage() {
  const { user, loading, logout } = useCurrentUser();

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted">Loading…</p>
      </main>
    );
  }
  if (!user) return null;

  const canManageStaff = user.roles.includes("SUPER_ADMIN") || user.roles.includes("ADMIN");

  return (
    <AppShell user={user} onLogout={logout}>
      <Letterhead eyebrow={user.roles.join(" · ")} title={`Good to see you, ${user.firstName}.`} />

      <Card>
        <CardHeader title="Your account" sub={user.email} />
        <nav className="flex flex-wrap gap-4 text-sm">
          <Link href="/students" className="font-medium underline hover:no-underline">
            Students
          </Link>
          {canManageStaff && (
            <>
              <Link href="/staff" className="font-medium underline hover:no-underline">
                Staff assignments
              </Link>
              <Link href="/invitations" className="font-medium underline hover:no-underline">
                Invitations
              </Link>
            </>
          )}
        </nav>
        <p className="mt-4 text-[11.5px] text-muted">
          Phase 2 (People, BUILD_PLAN.md §4) is live — Subjects, Assessment, and everything else
          arrive in later phases.
        </p>
      </Card>
    </AppShell>
  );
}
