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
 * PRD FR1.9: Super-Admin -> another user, atomic and owner-only. There's no
 * user-search UI yet (Phase 2 doesn't build one for any resource), so the
 * target is identified by their User id directly.
 */
export function OwnershipTransferAction() {
  const [targetUserId, setTargetUserId] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/ownership/transfer", {
        method: "POST",
        auth: true,
        body: { targetUserId },
      });
      setSuccess("Ownership transferred. Log in again to see your updated role.");
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold">Transfer ownership</h2>
      {success && <p className="text-sm text-green-600 dark:text-green-400">{success}</p>}
      <FormField
        label="Target user ID"
        id="ownership-target-user-id"
        required
        value={targetUserId}
        onChange={(e) => setTargetUserId(e.target.value)}
      />
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button variant="outline" disabled={!targetUserId}>
            Transfer ownership…
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogTitle className="text-lg font-semibold">Confirm ownership transfer</AlertDialogTitle>
          <AlertDialogDescription className="mt-2 text-sm text-muted">
            You will be demoted to Admin and this user will become the new Super-Admin. This
            cannot be undone from here.
          </AlertDialogDescription>
          {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <AlertDialogCancel asChild>
              <Button variant="outline">Cancel</Button>
            </AlertDialogCancel>
            {/* Plain Button, not AlertDialogAction — Action auto-closes on click,
                which would hide a failed-transfer error before the user reads it. */}
            <Button onClick={handleConfirm} disabled={submitting}>
              {submitting ? "Transferring…" : "Confirm transfer"}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
