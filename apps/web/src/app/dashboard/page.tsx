"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, tokenStorage } from "../../lib/api";

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
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          Welcome, {me.firstName} {me.lastName}
        </h1>
        <button onClick={handleLogout} className="rounded border border-border px-3 py-1 text-sm">
          Log out
        </button>
      </div>
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
