"use client";

import { useState } from "react";
import { useCurrentUser } from "../../lib/use-current-user";
import { AppShell } from "../../components/templates/app-shell";
import { PageLoadingSkeleton } from "../../components/templates/page-loading-skeleton";
import { Letterhead } from "../../components/molecules/letterhead";
import { Card, CardHeader } from "../../components/molecules/card";
import { InvitePersonForm } from "../../components/organisms/invite-person-form";
import { PendingInvitationsList } from "../../components/organisms/pending-invitations-list";

export default function InvitationsPage() {
  const { user, loading, logout } = useCurrentUser();
  const [refreshKey, setRefreshKey] = useState(0);

  if (loading) {
    return <PageLoadingSkeleton />;
  }
  if (!user) return null;

  const isSuperAdmin = user.roles.includes("SUPER_ADMIN");
  const canInvite = isSuperAdmin || user.roles.includes("ADMIN");

  return (
    <AppShell user={user} onLogout={logout}>
      <Letterhead eyebrow="People · Invitations" title="Invitations" />

      {canInvite ? (
        <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader title="Pending invitations" />
            <PendingInvitationsList refreshKey={refreshKey} />
          </Card>
          <Card>
            <CardHeader title="Invite a person" />
            <InvitePersonForm isSuperAdmin={isSuperAdmin} onInvited={() => setRefreshKey((k) => k + 1)} />
          </Card>
        </div>
      ) : (
        <Card>
          <p className="text-sm text-muted">You don&apos;t have permission to invite people.</p>
        </Card>
      )}
    </AppShell>
  );
}
