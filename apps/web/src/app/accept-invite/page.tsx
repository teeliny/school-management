"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, ApiError } from "../../lib/api";

interface InvitationPeek {
  email: string;
  invitedRole: string;
  status: string;
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInviteForm />
    </Suspense>
  );
}

function AcceptInviteForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";

  const [invitation, setInvitation] = useState<InvitationPeek | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoadError("Missing invitation token");
      return;
    }
    apiFetch<InvitationPeek>(`/invitations/${token}`)
      .then(setInvitation)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Invitation not found"));
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    try {
      await apiFetch(`/invitations/${token}/accept`, { method: "POST", body: { password } });
      router.push("/login");
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-red-600">{loadError}</p>
      </main>
    );
  }

  if (!invitation) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-gray-500">Loading…</p>
      </main>
    );
  }

  if (invitation.status !== "PENDING") {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-gray-500">
          This invitation is {invitation.status.toLowerCase()} and can no longer be accepted.
        </p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 p-6">
        <h1 className="text-xl font-semibold">Set up your account</h1>
        <p className="text-sm text-gray-600">
          Accepting invitation for <strong>{invitation.email}</strong> as {invitation.invitedRole}.
        </p>
        {submitError && <p className="text-sm text-red-600">{submitError}</p>}
        <div>
          <label className="block text-sm font-medium" htmlFor="password">
            Choose a password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded border px-3 py-2"
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-black px-3 py-2 text-white disabled:opacity-50"
        >
          {submitting ? "Setting up…" : "Accept invitation"}
        </button>
      </form>
    </main>
  );
}
