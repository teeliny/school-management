"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, tokenStorage } from "../../lib/api";
import { DashboardHeader } from "../../components/organisms/dashboard-header";
import { InvitePersonForm } from "../../components/organisms/invite-person-form";
import { PendingInvitationsList } from "../../components/organisms/pending-invitations-list";

interface Me {
  firstName: string;
  lastName: string;
  roles: string[];
}

export default function InvitationsPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!tokenStorage.accessToken) {
      router.replace("/login");
      return;
    }
    apiFetch<Me>("/auth/me", { auth: true })
      .then(setMe)
      .catch(() => router.replace("/login"))
      .finally(() => setLoading(false));
  }, [router]);

  async function handleLogout() {
    const refreshToken = tokenStorage.refreshToken;
    tokenStorage.clear();
    if (refreshToken) {
      await apiFetch("/auth/logout", { method: "POST", body: { refreshToken } }).catch(() => {});
    }
    router.push("/login");
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted">Loading…</p>
      </main>
    );
  }
  if (!me) return null;

  const isSuperAdmin = me.roles.includes("SUPER_ADMIN");
  const canInvite = isSuperAdmin || me.roles.includes("ADMIN");

  return (
    <main className="mx-auto max-w-4xl space-y-8 p-6">
      <DashboardHeader firstName={me.firstName} lastName={me.lastName} onLogout={handleLogout} />

      {canInvite ? (
        <>
          <InvitePersonForm isSuperAdmin={isSuperAdmin} onInvited={() => setRefreshKey((k) => k + 1)} />
          <section>
            <h2 className="mb-3 text-lg font-semibold">Pending invitations</h2>
            <PendingInvitationsList refreshKey={refreshKey} />
          </section>
        </>
      ) : (
        <p className="text-sm text-muted">You don&apos;t have permission to invite people.</p>
      )}
    </main>
  );
}
