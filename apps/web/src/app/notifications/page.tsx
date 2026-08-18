"use client";

import { useCurrentUser } from "../../lib/use-current-user";
import { AppShell } from "../../components/templates/app-shell";
import { Letterhead } from "../../components/molecules/letterhead";
import { Card, CardHeader } from "../../components/molecules/card";
import { NotificationList } from "../../components/organisms/notification-list";

export default function NotificationsPage() {
  const { user, loading, logout } = useCurrentUser();

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
      <Letterhead eyebrow="Notifications" title="All activity" />

      <Card>
        <CardHeader title="Notifications" sub="Scroll to load more" />
        <NotificationList />
      </Card>
    </AppShell>
  );
}
