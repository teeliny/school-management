"use client";

import { useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "../../lib/api";
import { FormField } from "../molecules/form-field";
import { Button } from "../atoms/button";
import { CrestBadge } from "../atoms/crest-badge";
import { siteContent } from "../../lib/site-content";

/**
 * The backend always returns the same generic response regardless of
 * whether the email is registered (no account enumeration) — so success
 * always shows the same message; only a genuine request failure (network/
 * 500) shows an error.
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/auth/forgot-password", { method: "POST", body: { email } });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
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
      <h1 className="font-display mb-1 text-lg font-semibold">Reset your password</h1>
      <p className="mb-5 text-[11.5px] text-muted">Enter your email and we&apos;ll send you a reset link</p>

      {sent ? (
        <p className="rounded-lg bg-card-inset px-3 py-2.5 text-[11.5px] leading-relaxed text-muted">
          If that email is registered, a reset link has been sent. Check your inbox.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3.5 text-left">
          {error && <p className="text-sm text-danger">{error}</p>}
          <FormField
            label="Email"
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button type="submit" disabled={submitting} className="w-full justify-center">
            {submitting ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}

      <p className="mt-4 text-[11.5px] text-muted">
        <Link href="/login" className="text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
