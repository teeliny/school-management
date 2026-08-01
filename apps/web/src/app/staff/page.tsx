"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, tokenStorage } from "../../lib/api";
import { DashboardHeader } from "../../components/organisms/dashboard-header";
import { StaffAssignmentForm } from "../../components/organisms/staff-assignment-form";
import { StaffAssignmentList } from "../../components/organisms/staff-assignment-list";
import { OwnershipTransferAction } from "../../components/organisms/ownership-transfer-action";

interface Me {
  firstName: string;
  lastName: string;
  roles: string[];
}

export default function StaffPage() {
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
  const canManage = isSuperAdmin || me.roles.includes("ADMIN");

  return (
    <main className="mx-auto max-w-4xl space-y-8 p-6">
      <DashboardHeader firstName={me.firstName} lastName={me.lastName} onLogout={handleLogout} />

      {canManage ? (
        <>
          <StaffAssignmentForm
            isSuperAdmin={isSuperAdmin}
            onAssigned={() => setRefreshKey((k) => k + 1)}
          />
          <section>
            <h2 className="mb-3 text-lg font-semibold">Staff assignments</h2>
            <StaffAssignmentList refreshKey={refreshKey} />
          </section>
          {isSuperAdmin && (
            <section className="border-t border-border pt-6">
              <OwnershipTransferAction />
            </section>
          )}
        </>
      ) : (
        <p className="text-sm text-muted">You don&apos;t have permission to manage staff assignments.</p>
      )}
    </main>
  );
}
