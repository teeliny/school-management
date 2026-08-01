"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, tokenStorage } from "../../lib/api";
import { DashboardHeader } from "../../components/organisms/dashboard-header";

interface Me {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
}

export default function DashboardPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

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

  return (
    <main className="mx-auto max-w-2xl p-6">
      <DashboardHeader firstName={me.firstName} lastName={me.lastName} onLogout={handleLogout} />
      <p className="mt-2 text-sm text-muted">
        {me.email} — {me.roles.join(", ")}
      </p>
      <p className="mt-8 text-sm text-muted">
        This is Phase 1&apos;s empty dashboard shell (BUILD_PLAN.md §3) — Subjects, Assessment, and
        everything else arrive in later phases.
      </p>
    </main>
  );
}
