"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "../../lib/api";
import { formatCurrency } from "../../lib/currency";
import { Badge, type BadgeVariant } from "../atoms/badge";
import { Button } from "../atoms/button";
import { Input } from "../atoms/input";

interface PendingPaymentItem {
  id: string;
  amount: number;
  proofOfPaymentUrl: string | null;
  createdAt: string;
  invoice: { student: { admissionNumber: string; user: { firstName: string; lastName: string } } };
}
interface PendingDiscountRequestItem {
  id: string;
  type: "PERCENTAGE" | "FIXED_AMOUNT";
  value: number;
  reason: string;
  createdAt: string;
  invoice: { student: { admissionNumber: string; user: { firstName: string; lastName: string } } };
}

type QueueKind = "PAYMENT" | "DISCOUNT";
interface QueueRow {
  kind: QueueKind;
  id: string;
  createdAt: string;
  studentName: string;
  admissionNumber: string;
  amountLabel: string;
  proofUrl: string | null;
  reason: string | null;
}

const KIND_LABEL: Record<QueueKind, string> = { PAYMENT: "Bank transfer", DISCOUNT: "Discount" };
const KIND_VARIANT: Record<QueueKind, BadgeVariant> = { PAYMENT: "muted", DISCOUNT: "info" };

function approvePath(row: QueueRow) {
  return row.kind === "PAYMENT" ? `/payments/${row.id}/approve` : `/discount-requests/${row.id}/approve`;
}
function rejectPath(row: QueueRow) {
  return row.kind === "PAYMENT" ? `/payments/${row.id}/reject` : `/discount-requests/${row.id}/reject`;
}

/**
 * PRD FR7.3b/FR7.8: approve/reject for both manual bank-transfer payments
 * and discount requests is Super-Admin only — a manual role check in each
 * controller, not a CASL condition (Bursar's own "manage" grant on either
 * subject would satisfy any CASL check here too). This component assumes
 * its caller has already gated on `user.roles.includes("SUPER_ADMIN")`.
 * Unifies both PENDING_APPROVAL payments and PENDING discount requests into
 * one queue, sorted oldest-first, per the mockup's single review queue.
 */
export function PendingApprovalsQueue() {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  const { data: rows, error: queryError } = useQuery({
    queryKey: ["pending-approvals"],
    queryFn: async () => {
      const [payments, discountRequests] = await Promise.all([
        apiFetch<PendingPaymentItem[]>("/payments?status=PENDING_APPROVAL", { auth: true }),
        apiFetch<PendingDiscountRequestItem[]>("/discount-requests?status=PENDING", { auth: true }),
      ]);
      const merged: QueueRow[] = [
        ...payments.map((p): QueueRow => ({
          kind: "PAYMENT",
          id: p.id,
          createdAt: p.createdAt,
          studentName: `${p.invoice.student.user.firstName} ${p.invoice.student.user.lastName}`,
          admissionNumber: p.invoice.student.admissionNumber,
          amountLabel: formatCurrency(p.amount),
          proofUrl: p.proofOfPaymentUrl,
          reason: null,
        })),
        ...discountRequests.map((d): QueueRow => ({
          kind: "DISCOUNT",
          id: d.id,
          createdAt: d.createdAt,
          studentName: `${d.invoice.student.user.firstName} ${d.invoice.student.user.lastName}`,
          admissionNumber: d.invoice.student.admissionNumber,
          amountLabel: d.type === "PERCENTAGE" ? `${d.value}% discount` : `${formatCurrency(d.value)} discount`,
          proofUrl: null,
          reason: d.reason,
        })),
      ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      return merged;
    },
  });
  const error =
    actionError ?? (queryError instanceof ApiError ? queryError.message : queryError ? "Failed to load pending approvals" : null);

  async function handleApprove(row: QueueRow) {
    setActionError(null);
    setPendingActionId(row.id);
    try {
      await apiFetch(approvePath(row), { method: "PATCH", auth: true });
      queryClient.invalidateQueries({ queryKey: ["pending-approvals"] });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Failed to approve");
    } finally {
      setPendingActionId(null);
    }
  }

  async function handleReject(row: QueueRow) {
    setActionError(null);
    setPendingActionId(row.id);
    try {
      await apiFetch(rejectPath(row), { method: "PATCH", auth: true, body: { rejectionReason } });
      setRejectingId(null);
      setRejectionReason("");
      queryClient.invalidateQueries({ queryKey: ["pending-approvals"] });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Failed to reject");
    } finally {
      setPendingActionId(null);
    }
  }

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!rows) return <p className="text-sm text-muted">Loading…</p>;
  if (rows.length === 0) return <p className="text-sm text-muted">Nothing awaiting review.</p>;

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={`${row.kind}-${row.id}`} className="rounded-lg border border-border p-2.5 text-[12.5px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <Badge variant={KIND_VARIANT[row.kind]}>{KIND_LABEL[row.kind]}</Badge>{" "}
              {row.studentName} <span className="font-mono text-muted">({row.admissionNumber})</span>{" "}
              <span className="font-mono">{row.amountLabel}</span>
              {row.reason && <span className="text-muted"> — {row.reason}</span>}
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {row.proofUrl && (
                <a href={row.proofUrl} target="_blank" rel="noreferrer" className="text-primary underline">
                  View proof
                </a>
              )}
              <Button type="button" size="sm" disabled={pendingActionId === row.id} onClick={() => handleApprove(row)}>
                Approve
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pendingActionId === row.id}
                onClick={() => {
                  setRejectingId(rejectingId === row.id ? null : row.id);
                  setRejectionReason("");
                }}
              >
                Reject
              </Button>
            </div>
          </div>
          {rejectingId === row.id && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Input
                placeholder="Reason for rejection"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                className="max-w-xs"
              />
              <Button
                type="button"
                size="sm"
                disabled={!rejectionReason.trim() || pendingActionId === row.id}
                onClick={() => handleReject(row)}
              >
                Confirm reject
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setRejectingId(null)}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
