"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { Input } from "../atoms/input";

export interface EditablePendingPayment {
  id: string;
  amount: number;
  method: string;
}

/**
 * PATCH /payments/:id — the recorder's edit of their own still-
 * PENDING_APPROVAL CASH/BANK_TRANSFER_MANUAL payment: the amount, plus an
 * optional replacement proof file for a manual transfer. Shared by
 * InvoicePaymentsList and BursarDashboard. `onFailed` lets the caller reload
 * after a refused save — most likely the Super-Admin reviewed it meanwhile,
 * so the caller's list is stale.
 */
export function EditPendingPaymentForm({
  payment,
  onSaved,
  onFailed,
  onCancel,
}: {
  payment: EditablePendingPayment;
  onSaved: () => void;
  onFailed?: () => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState(String(payment.amount));
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isManualTransfer = payment.method === "BANK_TRANSFER_MANUAL";

  async function handleSave() {
    setError(null);
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("amount", amount);
      if (file) formData.append("file", file);
      await apiFetch(`/payments/${payment.id}`, { method: "PATCH", auth: true, body: formData });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update payment");
      onFailed?.();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-1">
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="number"
          min="0.01"
          step="any"
          aria-label="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="max-w-[10rem]"
        />
        {isManualTransfer && (
          <Input
            type="file"
            aria-label="Replacement proof of payment (optional)"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="max-w-xs"
          />
        )}
        <Button type="button" size="sm" disabled={!(Number(amount) > 0) || submitting} onClick={handleSave}>
          {submitting ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {isManualTransfer && <p className="text-[11.5px] text-muted">Leave the file empty to keep the current proof.</p>}
    </div>
  );
}
