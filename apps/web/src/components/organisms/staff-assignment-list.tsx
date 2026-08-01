"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { Badge } from "../atoms/badge";

interface StaffAssignment {
  id: string;
  assignmentType: string;
  classArmId: string | null;
  academicSessionId: string;
  isActive: boolean;
}

export function StaffAssignmentList({ refreshKey }: { refreshKey?: unknown }) {
  const [assignments, setAssignments] = useState<StaffAssignment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<StaffAssignment[]>("/staff-assignments", { auth: true })
      .then(setAssignments)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load assignments"));
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function handleRevoke(id: string) {
    setRevokingId(id);
    try {
      await apiFetch(`/staff-assignments/${id}/revoke`, { method: "PATCH", auth: true });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to revoke assignment");
    } finally {
      setRevokingId(null);
    }
  }

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!assignments) return <p className="text-sm text-muted">Loading…</p>;
  if (assignments.length === 0) return <p className="text-sm text-muted">No assignments yet.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[12.5px]">
        <thead>
          <tr className="border-b border-border text-muted">
            <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Type</th>
            <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Status</th>
            <th className="py-2 text-[10px] font-medium uppercase tracking-wide">Actions</th>
          </tr>
        </thead>
        <tbody>
          {assignments.map((assignment) => (
            <tr key={assignment.id} className="border-b border-border/60 last:border-none">
              <td className="py-2.5 pr-4 font-medium">{assignment.assignmentType}</td>
              <td className="py-2.5 pr-4">
                <Badge variant={assignment.isActive ? "success" : "muted"}>
                  {assignment.isActive ? "Active" : "Revoked"}
                </Badge>
              </td>
              <td className="py-2.5">
                {assignment.isActive && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={revokingId === assignment.id}
                    onClick={() => handleRevoke(assignment.id)}
                  >
                    Revoke
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
