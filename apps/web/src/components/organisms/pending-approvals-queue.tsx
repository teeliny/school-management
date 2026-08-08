"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { formatCurrency } from "../../lib/currency";
import { Button } from "../atoms/button";
import { Input } from "../atoms/input";

interface PendingPaymentItem {
  id: string;
  amount: number;
  proofOfPaymentUrl: string | null;
  createdAt: string;
  invoice: {
    dueDate: string;
    student: { admissionNumber: string; user: { firstName: string; lastName: string } };
  };
}

/**
 * PRD FR7.3b: approve/reject is Super-Admin only — a manual role check in
 * the controller, not a CASL condition (Bursar's own "manage Payment" grant
 * would satisfy any CASL check here too). This component assumes its caller
 * has already gated on `user.roles.includes("SUPER_ADMIN")`.
 */
export function PendingApprovalsQueue() {
  const [payments, setPayments] = useState<PendingPaymentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  const load = useCallback(() => {
    apiFetch<PendingPaymentItem[]>("/payments?status=PENDING_APPROVAL", { auth: true })
      .then(setPayments)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load pending approvals"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleApprove(id: string) {
    setError(null);
    setPendingActionId(id);
    try {
      await apiFetch(`/payments/${id}/approve`, { method: "PATCH", auth: true });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to approve payment");
    } finally {
      setPendingActionId(null);
    }
  }

  async function handleReject(id: string) {
    setError(null);
    setPendingActionId(id);
    try {
      await apiFetch(`/payments/${id}/reject`, { method: "PATCH", auth: true, body: { rejectionReason } });
      setRejectingId(null);
      setRejectionReason("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to reject payment");
    } finally {
      setPendingActionId(null);
    }
  }

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!payments) return <p className="text-sm text-muted">Loading…</p>;
  if (payments.length === 0) return <p className="text-sm text-muted">No manual bank-transfer submissions awaiting review.</p>;

  return (
    <div className="space-y-2">
      {payments.map((payment) => (
        <div key={payment.id} className="rounded-lg border border-border p-2.5 text-[12.5px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {payment.invoice.student.user.firstName} {payment.invoice.student.user.lastName}{" "}
              <span className="font-mono text-muted">({payment.invoice.student.admissionNumber})</span>{" "}
              <span className="font-mono">{formatCurrency(payment.amount)}</span>
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {payment.proofOfPaymentUrl && (
                <a href={payment.proofOfPaymentUrl} target="_blank" rel="noreferrer" className="text-primary underline">
                  View proof
                </a>
              )}
              <Button type="button" size="sm" disabled={pendingActionId === payment.id} onClick={() => handleApprove(payment.id)}>
                Approve
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pendingActionId === payment.id}
                onClick={() => {
                  setRejectingId(rejectingId === payment.id ? null : payment.id);
                  setRejectionReason("");
                }}
              >
                Reject
              </Button>
            </div>
          </div>
          {rejectingId === payment.id && (
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
                disabled={!rejectionReason.trim() || pendingActionId === payment.id}
                onClick={() => handleReject(payment.id)}
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
