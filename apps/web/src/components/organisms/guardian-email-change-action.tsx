"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { FormField } from "../molecules/form-field";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../molecules/alert-dialog";

/**
 * One-time email correction/confirmation (PATCH /parent-profiles/:id/email)
 * — mainly for guardians onboarded via the legacy CSV import who often
 * start with a synthetic placeholder address. Setting a real email here is
 * what actually sends the parent a password-reset email; the control is
 * hidden once ParentProfile.emailChangedByStaffAt is set (a second attempt
 * is also rejected server-side).
 */
export function GuardianEmailChangeAction({ parentProfileId, onChanged }: { parentProfileId: string; onChanged: () => void }) {
  const [email, setEmail] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch(`/parent-profiles/${parentProfileId}/email`, {
        method: "PATCH",
        auth: true,
        body: { email },
      });
      setOpen(false);
      setEmail("");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          Change email…
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle className="text-lg font-semibold">Change guardian email</AlertDialogTitle>
        <AlertDialogDescription className="mt-2 text-sm text-muted">
          This can only be done once for this guardian. Setting it sends them an email to set their
          password.
        </AlertDialogDescription>
        <div className="mt-3">
          <FormField
            label="New email"
            id={`guardian-email-${parentProfileId}`}
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <AlertDialogCancel asChild>
            <Button variant="outline">Cancel</Button>
          </AlertDialogCancel>
          {/* Plain Button, not AlertDialogAction — Action auto-closes on click,
              which would hide a failed-request error before the user reads it. */}
          <Button onClick={handleConfirm} disabled={submitting || !email}>
            {submitting ? "Saving…" : "Confirm change"}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
