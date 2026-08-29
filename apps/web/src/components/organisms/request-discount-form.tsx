"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { Input } from "../atoms/input";
import { Label } from "../atoms/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";

type DiscountType = "PERCENTAGE" | "FIXED_AMOUNT";

/** PRD FR7.8: Bursar/Super-Admin raise; the server rejects a >100% value or an invoice with no outstanding balance. */
export function RequestDiscountForm({ invoiceId, onRequested }: { invoiceId: string; onRequested: () => void }) {
  const [type, setType] = useState<DiscountType>("PERCENTAGE");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await apiFetch("/discount-requests", {
        method: "POST",
        auth: true,
        body: { invoiceId, type, value: Number(value), reason },
      });
      setSuccess("Discount request submitted for Super-Admin approval.");
      setValue("");
      setReason("");
      onRequested();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to submit discount request");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-border p-3">
      <p className="text-[12px] font-medium uppercase tracking-wide text-muted">Request a discount</p>
      {error && <p className="text-sm text-danger">{error}</p>}
      {success && <p className="text-sm text-success">{success}</p>}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <Label htmlFor="rd-type">Type</Label>
          <Select value={type} onValueChange={(v) => setType(v as DiscountType)}>
            <SelectTrigger id="rd-type" className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PERCENTAGE">Percentage</SelectItem>
              <SelectItem value="FIXED_AMOUNT">Fixed amount</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="rd-value">{type === "PERCENTAGE" ? "Value (%)" : "Value"}</Label>
          <Input
            id="rd-value"
            type="number"
            min="0.01"
            max={type === "PERCENTAGE" ? "100" : undefined}
            step="any"
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-1"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="rd-reason">Reason</Label>
        <Input id="rd-reason" required value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1" />
      </div>

      <Button type="submit" disabled={submitting}>
        {submitting ? "Submitting…" : "Submit for approval"}
      </Button>
    </form>
  );
}
