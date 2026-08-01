"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { Badge, type BadgeVariant } from "../atoms/badge";

interface Invitation {
  id: string;
  email: string;
  invitedRole: string;
  status: string;
  expiresAt: string;
}

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  PENDING: "warning",
  ACCEPTED: "success",
  EXPIRED: "muted",
  REVOKED: "danger",
};

export function PendingInvitationsList({ refreshKey }: { refreshKey?: unknown }) {
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<Invitation[]>("/invitations", { auth: true })
      .then(setInvitations)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load invitations"));
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function handleResend(id: string) {
    setPendingActionId(id);
    try {
      await apiFetch(`/invitations/${id}/resend`, { method: "PATCH", auth: true });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to resend invitation");
    } finally {
      setPendingActionId(null);
    }
  }

  async function handleRevoke(id: string) {
    setPendingActionId(id);
    try {
      await apiFetch(`/invitations/${id}/revoke`, { method: "PATCH", auth: true });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to revoke invitation");
    } finally {
      setPendingActionId(null);
    }
  }

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!invitations) return <p className="text-sm text-muted">Loading…</p>;
  if (invitations.length === 0) {
    return <p className="text-sm text-muted">No pending invitations.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[12.5px]">
        <thead>
          <tr className="border-b border-border text-muted">
            <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Email</th>
            <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Role</th>
            <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Status</th>
            <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Expires</th>
            <th className="py-2 text-[10px] font-medium uppercase tracking-wide">Actions</th>
          </tr>
        </thead>
        <tbody>
          {invitations.map((invitation) => (
            <tr key={invitation.id} className="border-b border-border/60 last:border-none">
              <td className="py-2.5 pr-4 font-medium">{invitation.email}</td>
              <td className="py-2.5 pr-4">{invitation.invitedRole}</td>
              <td className="py-2.5 pr-4">
                <Badge variant={STATUS_VARIANT[invitation.status] ?? "muted"}>{invitation.status}</Badge>
              </td>
              <td className="py-2.5 pr-4 font-mono text-muted">
                {new Date(invitation.expiresAt).toLocaleDateString()}
              </td>
              <td className="space-x-2 py-2.5">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pendingActionId === invitation.id}
                  onClick={() => handleResend(invitation.id)}
                >
                  Resend
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pendingActionId === invitation.id}
                  onClick={() => handleRevoke(invitation.id)}
                >
                  Revoke
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
