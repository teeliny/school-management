"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { Input } from "../atoms/input";
import { Label } from "../atoms/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";

type DiscountType = "PERCENTAGE" | "FIXED_AMOUNT";

export interface EditableDiscountRequest {
  id: string;
  type: DiscountType;
  value: number;
  reason: string;
  feeStructureId: string | null;
}

/**
 * PATCH /discount-requests/:id — the raiser's edit of their own still-PENDING
 * request. A fee waiver's amount is copied off the billed fee server-side, so
 * only its reason is editable. Shared by InvoiceDiscountRequestsList and
 * BursarDashboard; see EditPendingPaymentForm for
 * `onFailed`.
 */
export function EditDiscountRequestForm({
  request,
  onSaved,
  onFailed,
  onCancel,
}: {
  request: EditableDiscountRequest;
  onSaved: () => void;
  onFailed?: () => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<DiscountType>(request.type);
  const [value, setValue] = useState(String(request.value));
  const [reason, setReason] = useState(request.reason);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isFeeWaiver = Boolean(request.feeStructureId);
  const valueInvalid = !(Number(value) > 0) || (type === "PERCENTAGE" && Number(value) > 100);

  async function handleSave() {
    setError(null);
    setSubmitting(true);
    try {
      const body = isFeeWaiver ? { reason } : { type, value: Number(value), reason };
      await apiFetch(`/discount-requests/${request.id}`, { method: "PATCH", auth: true, body });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update discount request");
      onFailed?.();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-danger">{error}</p>}
      {isFeeWaiver ? (
        <p className="text-[11.5px] text-muted">A fee waiver&apos;s amount comes from the billed fee — only the reason can be changed.</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <Label htmlFor={`edr-type-${request.id}`}>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as DiscountType)}>
              <SelectTrigger id={`edr-type-${request.id}`} className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PERCENTAGE">Percentage</SelectItem>
                <SelectItem value="FIXED_AMOUNT">Fixed amount</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor={`edr-value-${request.id}`}>{type === "PERCENTAGE" ? "Value (%)" : "Value"}</Label>
            <Input
              id={`edr-value-${request.id}`}
              type="number"
              min="0.01"
              max={type === "PERCENTAGE" ? "100" : undefined}
              step="any"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="mt-1"
            />
          </div>
        </div>
      )}
      <div>
        <Label htmlFor={`edr-reason-${request.id}`}>Reason</Label>
        <Input id={`edr-reason-${request.id}`} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1" />
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={submitting || !reason.trim() || (!isFeeWaiver && valueInvalid)}
          onClick={handleSave}
        >
          {submitting ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
