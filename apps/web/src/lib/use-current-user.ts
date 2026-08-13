"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "./api";

export interface CurrentUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  assignmentTypes: string[];
  staffProfileId: string | null;
  studentProfileId: string | null;
  parentProfileId: string | null;
}

/**
 * Every authenticated page needs the same three things: fetch /auth/me (a 401
 * redirects to /login — tokens live in httpOnly cookies, so there's no
 * synchronous client-side check to short-circuit that), and offer a logout that
 * clears cookies and revokes the refresh token server-side. Centralized here
 * since the AppShell (avatar, role-gated nav) and every page under it all need
 * it identically.
 */
export function useCurrentUser() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<CurrentUser>("/auth/me", { auth: true })
      .then(setUser)
      .catch(() => router.replace("/login"))
      .finally(() => setLoading(false));
  }, [router]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/login");
  }

  return { user, loading, logout };
}
