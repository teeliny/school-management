"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError } from "../../lib/api";
import { FormField } from "../molecules/form-field";
import { Button } from "../atoms/button";
import { CrestBadge } from "../atoms/crest-badge";

// No GET peek endpoint exists for a reset token (unlike Invitation's
// /invitations/:token) — validity is only known at submit time, via
// POST /auth/reset-password's 400 on an invalid/expired token.
export function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!token) {
      setError("Missing reset token — use the link from your email.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch("/auth/reset-password", { method: "POST", body: { token, newPassword } });
      router.push("/login");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="w-[380px] max-w-full rounded-card border border-border bg-card px-8 py-8 text-center">
      <CrestBadge letter="S" variant="solid" size="lg" className="mx-auto mb-3.5" />
      <h1 className="font-display mb-1 text-lg font-semibold">Choose a new password</h1>
      <p className="mb-5 text-[11.5px] text-muted">Enter and confirm your new password</p>

      <form onSubmit={handleSubmit} className="space-y-3.5 text-left">
        {error && <p className="text-sm text-danger">{error}</p>}
        <FormField
          label="New password"
          id="newPassword"
          type="password"
          required
          minLength={8}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <FormField
          label="Confirm new password"
          id="confirmPassword"
          type="password"
          required
          minLength={8}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
        <Button type="submit" disabled={submitting} className="w-full justify-center">
          {submitting ? "Resetting…" : "Reset password"}
        </Button>
      </form>

      <p className="mt-4 text-[11.5px] text-muted">
        <Link href="/login" className="text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
