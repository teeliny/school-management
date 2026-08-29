"use client";

import { useCurrentUser } from "../../lib/use-current-user";
import { AppShell } from "../../components/templates/app-shell";
import { PageLoadingSkeleton } from "../../components/templates/page-loading-skeleton";
import { Letterhead } from "../../components/molecules/letterhead";
import { Card } from "../../components/molecules/card";
import { ParentProfileForm } from "../../components/organisms/parent-profile-form";

export default function ProfilePage() {
  const { user, loading, logout } = useCurrentUser();

  if (loading) {
    return <PageLoadingSkeleton />;
  }
  if (!user) return null;

  return (
    <AppShell user={user} onLogout={logout}>
      <Letterhead eyebrow="Account" title="My profile" />
      <Card>
        {user.parentProfileId ? (
          <ParentProfileForm parentProfileId={user.parentProfileId} />
        ) : (
          <p className="text-sm text-muted">There&apos;s no profile to manage here yet for your account.</p>
        )}
      </Card>
    </AppShell>
  );
}
