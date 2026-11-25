"use client";

import { useEffect, useState } from "react";
import { Percent } from "lucide-react";
import { apiFetch, ApiError } from "../../lib/api";
import { formatCurrency } from "../../lib/currency";
import { canEditFeeRequest, type FeeRequestViewer } from "../../lib/fee-request-ownership";
import { Badge, type BadgeVariant } from "../atoms/badge";
import { SkeletonList } from "../molecules/skeleton-list";
import { EmptyState } from "../molecules/empty-state";
import { EditDiscountRequestForm } from "./edit-discount-request-form";

type DiscountType = "PERCENTAGE" | "FIXED_AMOUNT";
type DiscountRequestStatus = "PENDING" | "APPROVED" | "REJECTED";
interface DiscountRequestItem {
  id: string;
  type: DiscountType;
  value: number;
  reason: string;
  status: DiscountRequestStatus;
  rejectionReason: string | null;
  createdAt: string;
  requestedByStaffId: string | null;
  feeStructureId: string | null;
  feeStructure: { name: string } | null;
}

const STATUS_VARIANT: Record<DiscountRequestStatus, BadgeVariant> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
};

function formatValue(request: DiscountRequestItem) {
  return request.type === "PERCENTAGE" ? `${request.value}%` : formatCurrency(request.value);
}

/**
 * Only rendered for Bursar/Super-Admin (InvoiceDetail's canManageFees).
 * "Edit" (EditDiscountRequestForm) is offered on a still-PENDING request only
 * to the `viewer` who raised it (canEditFeeRequest); the server refuses it
 * once the Super-Admin has approved/rejected.
 */
export function InvoiceDiscountRequestsList({
  invoiceId,
  refreshKey,
  viewer,
}: {
  invoiceId: string;
  refreshKey?: unknown;
  viewer?: FeeRequestViewer | null;
}) {
  const [requests, setRequests] = useState<DiscountRequestItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [localRefresh, setLocalRefresh] = useState(0);

  useEffect(() => {
    apiFetch<DiscountRequestItem[]>(`/discount-requests?invoiceId=${invoiceId}`, { auth: true })
      .then(setRequests)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load discount requests"));
  }, [invoiceId, refreshKey, localRefresh]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!requests) return <SkeletonList rows={2} />;
  if (requests.length === 0) return <EmptyState icon={Percent} title="No discount requests against this invoice yet" />;

  return (
    <div className="space-y-1.5">
      {requests.map((request) => (
        <div key={request.id} className="rounded-lg border border-border p-2.5 text-[12.5px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <span className="font-mono">{formatValue(request)}</span>{" "}
              {request.feeStructure ? `${request.feeStructure.name} fee waiver` : "discount"} — {request.reason}
            </span>
            <span className="flex items-center gap-2">
              {request.status === "PENDING" && canEditFeeRequest(request.requestedByStaffId, viewer) && (
                <button
                  type="button"
                  className="text-primary underline"
                  onClick={() => setEditingId(editingId === request.id ? null : request.id)}
                >
                  Edit
                </button>
              )}
              <Badge variant={STATUS_VARIANT[request.status]}>{request.status}</Badge>
            </span>
          </div>
          {request.status === "REJECTED" && request.rejectionReason && (
            <p className="mt-1 text-[11.5px] text-danger">Rejected: {request.rejectionReason}</p>
          )}
          {editingId === request.id && (
            <div className="mt-2 border-t border-border pt-2">
              <EditDiscountRequestForm
                request={request}
                onCancel={() => setEditingId(null)}
                onSaved={() => {
                  setEditingId(null);
                  setLocalRefresh((k) => k + 1);
                }}
                onFailed={() => setLocalRefresh((k) => k + 1)}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
