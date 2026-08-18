"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, ApiError } from "../../lib/api";
import { FormField } from "../molecules/form-field";
import { Button } from "../atoms/button";
import { CrestBadge } from "../atoms/crest-badge";

interface InvitationPeek {
  email: string;
  invitedRole: string;
  status: string;
}

export function AcceptInviteForm() {
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
    return <p className="text-sm text-danger">{loadError}</p>;
  }

  if (!invitation) {
    return <p className="text-sm text-muted">Loading…</p>;
  }

  if (invitation.status !== "PENDING") {
    return (
      <p className="text-sm text-muted">
        This invitation is {invitation.status.toLowerCase()} and can no longer be accepted.
      </p>
    );
  }

  return (
    <div className="w-[380px] max-w-full rounded-card border border-border bg-card px-8 py-8 text-center">
      <CrestBadge letter="S" variant="solid" size="lg" className="mx-auto mb-3.5" />
      <h1 className="font-display mb-1 text-lg font-semibold">Set up your account</h1>
      <p className="mb-5 text-[11.5px] text-muted">
        Accepting invitation for <strong>{invitation.email}</strong> as {invitation.invitedRole}
      </p>

      <form onSubmit={handleSubmit} className="space-y-3.5 text-left">
        {submitError && <p className="text-sm text-danger">{submitError}</p>}
        <FormField
          label="Choose a password"
          id="password"
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" disabled={submitting} className="w-full justify-center">
          {submitting ? "Setting up…" : "Accept invitation"}
        </Button>
      </form>
    </div>
  );
}
