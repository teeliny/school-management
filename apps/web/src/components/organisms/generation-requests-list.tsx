"use client";

import { useCallback, useEffect, useImperativeHandle, forwardRef, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Badge, type BadgeVariant } from "../atoms/badge";
import { Button } from "../atoms/button";

interface GenerationRequest {
  id: string;
  scope: string;
  status: "QUEUED" | "SOLVING" | "COMPLETED" | "FAILED" | "TIMED_OUT";
  requestedAt: string;
  errorMessage: string | null;
}

const STATUS_VARIANT: Record<GenerationRequest["status"], BadgeVariant> = {
  QUEUED: "warning",
  SOLVING: "warning",
  COMPLETED: "success",
  FAILED: "danger",
  TIMED_OUT: "danger",
};

export interface GenerationRequestsListHandle {
  refresh: () => void;
}

/**
 * BUILD_PLAN.md §9 Step 6: a manual-refresh status list over the
 * already-existing `GET /schedule-generation-requests` (built in Step 1) —
 * no polling, matching the "no polling loop precedent" noted when that
 * endpoint was first designed.
 */
export const GenerationRequestsList = forwardRef<GenerationRequestsListHandle>(function GenerationRequestsList(_props, ref) {
  const [requests, setRequests] = useState<GenerationRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const all = await apiFetch<GenerationRequest[]>("/schedule-generation-requests", { auth: true });
      setRequests(all.slice(0, 10));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load generation requests");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useImperativeHandle(ref, () => ({ refresh: load }), [load]);

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={load}>
          Refresh
        </Button>
      </div>
      {error && <p className="text-[12.5px] text-danger">{error}</p>}
      {!requests && !error && <p className="text-sm text-muted">Loading…</p>}
      {requests && requests.length === 0 && <p className="text-sm text-muted">No generation requests yet.</p>}
      {requests?.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2.5 text-[12.5px]">
          <span>
            <span className="font-mono text-muted">{r.id.slice(0, 8)}</span> {r.scope} —{" "}
            {new Date(r.requestedAt).toLocaleString()}
            {r.errorMessage && <span className="text-danger"> — {r.errorMessage}</span>}
          </span>
          <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
        </div>
      ))}
    </div>
  );
});
