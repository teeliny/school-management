"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";

interface Invitation {
  id: string;
  email: string;
  invitedRole: string;
  status: string;
  expiresAt: string;
}

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

  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!invitations) return <p className="text-sm text-muted">Loading…</p>;
  if (invitations.length === 0) {
    return <p className="text-sm text-muted">No pending invitations.</p>;
  }

  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-border text-muted">
          <th className="py-2 pr-4 font-medium">Email</th>
          <th className="py-2 pr-4 font-medium">Role</th>
          <th className="py-2 pr-4 font-medium">Status</th>
          <th className="py-2 pr-4 font-medium">Expires</th>
          <th className="py-2 font-medium">Actions</th>
        </tr>
      </thead>
      <tbody>
        {invitations.map((invitation) => (
          <tr key={invitation.id} className="border-b border-border">
            <td className="py-2 pr-4">{invitation.email}</td>
            <td className="py-2 pr-4">{invitation.invitedRole}</td>
            <td className="py-2 pr-4">{invitation.status}</td>
            <td className="py-2 pr-4">{new Date(invitation.expiresAt).toLocaleDateString()}</td>
            <td className="py-2 space-x-2">
              <Button
                variant="outline"
                className="px-2 py-1 text-xs"
                disabled={pendingActionId === invitation.id}
                onClick={() => handleResend(invitation.id)}
              >
                Resend
              </Button>
              <Button
                variant="outline"
                className="px-2 py-1 text-xs"
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
  );
}
