"use client";

import { useState } from "react";
import { useCurrentUser } from "../../lib/use-current-user";
import { AppShell } from "../../components/templates/app-shell";
import { Letterhead } from "../../components/molecules/letterhead";
import { Card, CardHeader } from "../../components/molecules/card";
import { StaffAssignmentForm } from "../../components/organisms/staff-assignment-form";
import { StaffAssignmentList } from "../../components/organisms/staff-assignment-list";
import { OwnershipTransferAction } from "../../components/organisms/ownership-transfer-action";

export default function StaffPage() {
  const { user, loading, logout } = useCurrentUser();
  const [refreshKey, setRefreshKey] = useState(0);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted">Loading…</p>
      </main>
    );
  }
  if (!user) return null;

  const isSuperAdmin = user.roles.includes("SUPER_ADMIN");
  const canManage = isSuperAdmin || user.roles.includes("ADMIN");

  return (
    <AppShell user={user} onLogout={logout}>
      <Letterhead eyebrow="People · Staff" title="Staff assignments" />

      {canManage ? (
        <div className="space-y-4">
          <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardHeader title="Assignments" />
              <StaffAssignmentList refreshKey={refreshKey} />
            </Card>
            <Card>
              <CardHeader title="Assign staff" />
              <StaffAssignmentForm
                isSuperAdmin={isSuperAdmin}
                onAssigned={() => setRefreshKey((k) => k + 1)}
              />
            </Card>
          </div>

          {isSuperAdmin && (
            <Card>
              <CardHeader title="Transfer ownership" sub="Super-Admin only, cannot be undone" />
              <OwnershipTransferAction />
            </Card>
          )}
        </div>
      ) : (
        <Card>
          <p className="text-sm text-muted">You don&apos;t have permission to manage staff assignments.</p>
        </Card>
      )}
    </AppShell>
  );
}
