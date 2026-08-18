"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { Input } from "../atoms/input";
import { Label } from "../atoms/label";
import { cn } from "../../lib/cn";

type Method = "CASH" | "BANK_TRANSFER_MANUAL";
const ALLOWED_PROOF_TYPES = "image/jpeg,image/png,image/webp,application/pdf";

/**
 * PRD §3.9/FR7.3a: CASH takes effect immediately; a bank-transfer submission
 * starts PENDING_APPROVAL and doesn't touch the invoice until a Super-Admin
 * reviews it (PendingApprovalsQueue). Two-button method toggle rather than a
 * Tabs component — only ever two options, not worth a new Radix dependency.
 */
export function RecordPaymentForm({
  invoiceId,
  outstandingBalance,
  onRecorded,
}: {
  invoiceId: string;
  outstandingBalance: number;
  onRecorded: () => void;
}) {
  const [method, setMethod] = useState<Method>("CASH");
  const [amount, setAmount] = useState(String(outstandingBalance));
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (method === "BANK_TRANSFER_MANUAL" && !file) {
      setError("Proof of payment file is required");
      return;
    }

    setSubmitting(true);
    try {
      if (method === "CASH") {
        await apiFetch("/payments/cash", { method: "POST", auth: true, body: { invoiceId, amount: Number(amount) } });
        setSuccess("Cash payment recorded.");
      } else {
        const formData = new FormData();
        formData.append("invoiceId", invoiceId);
        formData.append("amount", amount);
        formData.append("file", file as File);
        await apiFetch("/payments/bank-transfer", { method: "POST", auth: true, body: formData });
        setSuccess("Submitted for Super-Admin approval.");
      }
      setFile(null);
      onRecorded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to record payment");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-border p-3">
      <p className="text-[12px] font-medium uppercase tracking-wide text-muted">Record a payment</p>
      {error && <p className="text-sm text-danger">{error}</p>}
      {success && <p className="text-sm text-success">{success}</p>}

      <div className="flex gap-1.5">
        {(["CASH", "BANK_TRANSFER_MANUAL"] as Method[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMethod(m)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-[11.5px] font-medium transition-colors",
              method === m ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted hover:bg-card-inset",
            )}
          >
            {m === "CASH" ? "Cash" : "Bank transfer proof"}
          </button>
        ))}
      </div>

      <div>
        <Label htmlFor="rp-amount">Amount</Label>
        <Input
          id="rp-amount"
          type="number"
          min="0.01"
          step="any"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="mt-1"
        />
      </div>

      {method === "BANK_TRANSFER_MANUAL" && (
        <div>
          <Label htmlFor="rp-file">Proof of payment (JPEG, PNG, WebP, or PDF)</Label>
          <Input
            id="rp-file"
            type="file"
            accept={ALLOWED_PROOF_TYPES}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1"
          />
        </div>
      )}

      <Button type="submit" disabled={submitting}>
        {submitting ? "Submitting…" : method === "CASH" ? "Record cash payment" : "Submit for approval"}
      </Button>
    </form>
  );
}
