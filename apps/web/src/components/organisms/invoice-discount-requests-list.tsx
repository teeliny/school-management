"use client";

import { useEffect, useState } from "react";
import { Percent } from "lucide-react";
import { apiFetch, ApiError } from "../../lib/api";
import { formatCurrency } from "../../lib/currency";
import { Badge, type BadgeVariant } from "../atoms/badge";
import { SkeletonList } from "../molecules/skeleton-list";
import { EmptyState } from "../molecules/empty-state";

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
}

const STATUS_VARIANT: Record<DiscountRequestStatus, BadgeVariant> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
};

function formatValue(request: DiscountRequestItem) {
  return request.type === "PERCENTAGE" ? `${request.value}%` : formatCurrency(request.value);
}

export function InvoiceDiscountRequestsList({ invoiceId, refreshKey }: { invoiceId: string; refreshKey?: unknown }) {
  const [requests, setRequests] = useState<DiscountRequestItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<DiscountRequestItem[]>(`/discount-requests?invoiceId=${invoiceId}`, { auth: true })
      .then(setRequests)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load discount requests"));
  }, [invoiceId, refreshKey]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!requests) return <SkeletonList rows={2} />;
  if (requests.length === 0) return <EmptyState icon={Percent} title="No discount requests against this invoice yet" />;

  return (
    <div className="space-y-1.5">
      {requests.map((request) => (
        <div key={request.id} className="rounded-lg border border-border p-2.5 text-[12.5px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <span className="font-mono">{formatValue(request)}</span> discount — {request.reason}
            </span>
            <Badge variant={STATUS_VARIANT[request.status]}>{request.status}</Badge>
          </div>
          {request.status === "REJECTED" && request.rejectionReason && (
            <p className="mt-1 text-[11.5px] text-danger">Rejected: {request.rejectionReason}</p>
          )}
        </div>
      ))}
    </div>
  );
}
