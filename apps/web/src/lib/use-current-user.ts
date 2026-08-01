"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, tokenStorage } from "./api";

export interface CurrentUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
}

/**
 * Every authenticated page needs the same three things: redirect to /login if
 * there's no token, fetch /auth/me, and offer a logout that clears tokens and
 * revokes the refresh token server-side. Centralized here since the AppShell
 * (avatar, role-gated nav) and every page under it all need it identically.
 */
export function useCurrentUser() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tokenStorage.accessToken) {
      router.replace("/login");
      return;
    }
    apiFetch<CurrentUser>("/auth/me", { auth: true })
      .then(setUser)
      .catch(() => router.replace("/login"))
      .finally(() => setLoading(false));
  }, [router]);

  async function logout() {
    const refreshToken = tokenStorage.refreshToken;
    tokenStorage.clear();
    if (refreshToken) {
      await apiFetch("/auth/logout", { method: "POST", body: { refreshToken } }).catch(() => {});
    }
    router.push("/login");
  }

  return { user, loading, logout };
}
