"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, ApiError } from "../../lib/api";
import { FormField } from "../molecules/form-field";
import { Button } from "../atoms/button";
import { CrestBadge } from "../atoms/crest-badge";
import { siteContent } from "../../lib/site-content";

interface InvitationPeek {
  email: string;
  invitedRole: string;
  status: string;
  alreadyActiveAccount: boolean;
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
      const body = invitation?.alreadyActiveAccount ? {} : { password };
      await apiFetch(`/invitations/${token}/accept`, { method: "POST", body });
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
      <CrestBadge
        letter={siteContent.crestLetter}
        darkLetter={siteContent.crestLetterDark}
        variant="solid"
        size="lg"
        className="mx-auto mb-3.5"
      />
      <h1 className="font-display mb-1 text-lg font-semibold">
        {invitation.alreadyActiveAccount ? "Add a role to your account" : "Set up your account"}
      </h1>
      <p className="mb-5 text-[11.5px] text-muted">
        {invitation.alreadyActiveAccount ? (
          <>
            You already have an account for <strong>{invitation.email}</strong>. Accepting will add the{" "}
            {invitation.invitedRole} role — your existing password stays the same.
          </>
        ) : (
          <>
            Accepting invitation for <strong>{invitation.email}</strong> as {invitation.invitedRole}
          </>
        )}
      </p>

      <form onSubmit={handleSubmit} className="space-y-3.5 text-left">
        {submitError && <p className="text-sm text-danger">{submitError}</p>}
        {!invitation.alreadyActiveAccount && (
          <FormField
            label="Choose a password"
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
        <Button type="submit" disabled={submitting} className="w-full justify-center">
          {submitting ? "Working…" : "Accept invitation"}
        </Button>
      </form>
    </div>
  );
}
