"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { login, ApiError } from "../../lib/api";
import { FormField } from "../molecules/form-field";
import { Button } from "../atoms/button";
import { CrestBadge } from "../atoms/crest-badge";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="w-[380px] max-w-full rounded-card border border-border bg-card px-8 py-8 text-center">
      <CrestBadge letter="S" variant="solid" size="lg" className="mx-auto mb-3.5" />
      <h1 className="font-display mb-1 text-lg font-semibold">Sign in</h1>
      <p className="mb-5 text-[11.5px] text-muted">Staff, parent & student sign in</p>

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
        <FormField
          label="Password"
          id="password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" disabled={submitting} className="w-full justify-center">
          {submitting ? "Logging in…" : "Sign in"}
        </Button>
      </form>

      <p className="mt-4 rounded-lg bg-card-inset px-3 py-2.5 text-[11.5px] leading-relaxed text-muted">
        This account was created by invitation. Accounts aren&apos;t self-registered — ask your
        school admin for access.
      </p>
    </div>
  );
}
