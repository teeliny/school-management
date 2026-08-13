"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "../../lib/api";
import { Badge, type BadgeVariant } from "../atoms/badge";
import { Button } from "../atoms/button";
import { Checkbox } from "../atoms/checkbox";
import { Input } from "../atoms/input";

interface TimetableSlotItem {
  id: string;
  scheduleGenerationRequestId: string | null;
  classArmId: string;
  classArm: { displayName: string };
  createdAt: string;
}
interface ExamScheduleItem {
  id: string;
  scheduleGenerationRequestId: string | null;
  assessmentComponentId: string;
  classArm: { displayName: string };
  createdAt: string;
}
interface InvigilationAssignmentItem {
  id: string;
  scheduleGenerationRequestId: string | null;
  examSchedule: { assessmentComponentId: string; classArm: { displayName: string } };
  createdAt: string;
}
interface DutyAssignmentItem {
  id: string;
  scheduleGenerationRequestId: string | null;
  classLevelCategoryGroup: string;
  createdAt: string;
}

type QueueKind = "CLASS_TIMETABLE" | "EXAM_TIMETABLE" | "INVIGILATION" | "WEEKLY_DUTY";

interface QueueGroup {
  kind: QueueKind;
  requestId: string;
  label: string;
  itemCount: number;
  createdAt: string;
  gridHref: string;
}

const KIND_LABEL: Record<QueueKind, string> = {
  CLASS_TIMETABLE: "Class timetable",
  EXAM_TIMETABLE: "Exam timetable",
  INVIGILATION: "Invigilation",
  WEEKLY_DUTY: "Weekly duty",
};
const KIND_VARIANT: Record<QueueKind, BadgeVariant> = {
  CLASS_TIMETABLE: "muted",
  EXAM_TIMETABLE: "info",
  INVIGILATION: "info",
  WEEKLY_DUTY: "muted",
};
function groupByRequest<T extends { id: string; scheduleGenerationRequestId: string | null; createdAt: string }>(
  items: T[],
  kind: QueueKind,
  labelOf: (items: T[]) => string,
  hrefOf: (requestId: string, items: T[]) => string,
): QueueGroup[] {
  const byRequest = new Map<string, T[]>();
  for (const item of items) {
    // AI rows always carry this FK (set by the callback controller); a null
    // here would mean a MANUAL row, which is never PENDING_REVIEW in the
    // first place — skip defensively rather than crash on a malformed group.
    if (!item.scheduleGenerationRequestId) continue;
    const list = byRequest.get(item.scheduleGenerationRequestId) ?? [];
    list.push(item);
    byRequest.set(item.scheduleGenerationRequestId, list);
  }
  return [...byRequest.entries()].map(([requestId, groupItems]) => ({
    kind,
    requestId,
    label: labelOf(groupItems),
    itemCount: groupItems.length,
    // groupItems is never empty — only ever created by pushing at least one
    // item (see the `byRequest.get(...) ?? []` above) — the `!` just tells
    // noUncheckedIndexedAccess what the loop above already guarantees.
    createdAt: groupItems.reduce((min, i) => (i.createdAt < min ? i.createdAt : min), groupItems[0]!.createdAt),
    gridHref: hrefOf(requestId, groupItems),
  }));
}

/**
 * One row per generation run (`ScheduleGenerationRequest`), not one row per
 * generated item — real grouping via `scheduleGenerationRequestId` now that
 * every row carries it, not a client-side natural-key guess. Approve/reject
 * are each a single call to the batch endpoints on
 * `ScheduleGenerationRequestController` (Super-Admin only — `canAct` gates
 * whether those controls render at all; a Registrar/Principal/Headteacher/
 * Admin viewer sees the same list read-only). Individual bad rows are culled
 * via each row's own Reject button in its grid (reached through "View &
 * edit" below), not from this queue — this view's whole point is that
 * approval here is one action per roster.
 */
export const SchedulingApprovalsQueue = forwardRef<{ refresh: () => void }, { canAct: boolean }>(
  function SchedulingApprovalsQueue({ canAct }, ref) {
    const [groups, setGroups] = useState<QueueGroup[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [actingKey, setActingKey] = useState<string | null>(null);
    const [rejectingRequestId, setRejectingRequestId] = useState<string | null>(null);
    const [rejectionReason, setRejectionReason] = useState("");

    const load = useCallback(async () => {
      setError(null);
      try {
        // Promise.allSettled, not Promise.all — a viewer who can view but
        // not act on some kind (or a kind that 403s for their scope) must
        // not blackout the others they're allowed to see.
        const results = await Promise.allSettled([
          apiFetch<TimetableSlotItem[]>("/timetable-slots?approvalStatus=PENDING_REVIEW", { auth: true }),
          apiFetch<ExamScheduleItem[]>("/exam-schedules?approvalStatus=PENDING_REVIEW", { auth: true }),
          apiFetch<InvigilationAssignmentItem[]>("/invigilation-assignments?approvalStatus=PENDING_REVIEW", { auth: true }),
          apiFetch<DutyAssignmentItem[]>("/duty-assignments?approvalStatus=PENDING_REVIEW", { auth: true }),
        ]);
        if (results.every((r) => r.status === "rejected")) {
          const first = results[0];
          throw first.status === "rejected" ? first.reason : new Error("Failed to load pending schedule items");
        }
        const [slotsR, examSchedulesR, invigilationsR, dutiesR] = results;
        const slots = slotsR.status === "fulfilled" ? slotsR.value : [];
        const examSchedules = examSchedulesR.status === "fulfilled" ? examSchedulesR.value : [];
        const invigilations = invigilationsR.status === "fulfilled" ? invigilationsR.value : [];
        const duties = dutiesR.status === "fulfilled" ? dutiesR.value : [];

        const slotGroups = groupByRequest(
          slots,
          "CLASS_TIMETABLE",
          (items) => [...new Set(items.map((i) => i.classArm.displayName))].join(", "),
          (requestId, items) => {
            const distinctArms = [...new Set(items.map((i) => i.classArmId))];
            return distinctArms.length === 1
              ? `/scheduling?tab=class-timetable&classArmId=${distinctArms[0]}`
              : `/scheduling?tab=class-timetable`;
          },
        );
        const examGroups = groupByRequest(
          examSchedules,
          "EXAM_TIMETABLE",
          (items) => [...new Set(items.map((i) => i.classArm.displayName))].join(", "),
          (_requestId, items) => `/scheduling?tab=exam-timetable&assessmentComponentId=${items[0]!.assessmentComponentId}`,
        );
        const invigGroups = groupByRequest(
          invigilations,
          "INVIGILATION",
          (items) => [...new Set(items.map((i) => i.examSchedule.classArm.displayName))].join(", "),
          (_requestId, items) => `/scheduling?tab=invigilation&assessmentComponentId=${items[0]!.examSchedule.assessmentComponentId}`,
        );
        const dutyGroups = groupByRequest(
          duties,
          "WEEKLY_DUTY",
          (items) => items[0]?.classLevelCategoryGroup ?? "",
          (_requestId, items) => `/scheduling?tab=weekly-duty&classLevelCategoryGroup=${items[0]!.classLevelCategoryGroup}`,
        );

        setGroups(
          [...slotGroups, ...examGroups, ...invigGroups, ...dutyGroups].sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
          ),
        );
        setSelected(new Set());
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to load pending schedule items");
      }
    }, []);

    useEffect(() => {
      load();
    }, [load]);

    useImperativeHandle(ref, () => ({ refresh: load }), [load]);

    async function approveRequest(requestId: string) {
      await apiFetch(`/schedule-generation-requests/${requestId}/approve`, { method: "PATCH", auth: true });
    }

    async function handleApproveGroup(group: QueueGroup) {
      setError(null);
      setActingKey(group.requestId);
      try {
        await approveRequest(group.requestId);
        await load();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to approve this roster");
      } finally {
        setActingKey(null);
      }
    }

    async function handleBulkApprove() {
      if (!groups) return;
      setError(null);
      setActingKey("__bulk__");
      const targets = groups.filter((g) => selected.has(g.requestId));
      try {
        for (const group of targets) await approveRequest(group.requestId);
        await load();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to approve one or more selected rosters");
        await load();
      } finally {
        setActingKey(null);
      }
    }

    async function handleRejectGroup(group: QueueGroup) {
      setError(null);
      setActingKey(group.requestId);
      try {
        await apiFetch(`/schedule-generation-requests/${group.requestId}/reject`, {
          method: "PATCH",
          auth: true,
          body: { rejectionReason },
        });
        setRejectingRequestId(null);
        setRejectionReason("");
        await load();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to reject this roster");
      } finally {
        setActingKey(null);
      }
    }

    if (error && !groups) return <p className="text-sm text-danger">{error}</p>;
    if (!groups) return <p className="text-sm text-muted">Loading…</p>;
    if (groups.length === 0) return <p className="text-sm text-muted">Nothing awaiting review.</p>;

    const allSelected = groups.length > 0 && selected.size === groups.length;

    return (
      <div className="space-y-2">
        {error && <p className="text-[12.5px] text-danger">{error}</p>}
        {canAct && (
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] text-muted">{selected.size} selected</span>
            <Button type="button" size="sm" disabled={selected.size === 0 || actingKey === "__bulk__"} onClick={handleBulkApprove}>
              {actingKey === "__bulk__" ? "Approving…" : `Approve selected (${selected.size})`}
            </Button>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-border text-[10.5px] uppercase tracking-wide text-muted">
                {canAct && (
                  <th className="w-8 py-2">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={(checked) => setSelected(checked ? new Set(groups.map((g) => g.requestId)) : new Set())}
                    />
                  </th>
                )}
                <th className="py-2 pr-3 font-medium">Type</th>
                <th className="py-2 pr-3 font-medium">Roster</th>
                {canAct && <th className="py-2 pr-0 text-right font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.requestId} className="border-b border-border align-top">
                  {canAct && (
                    <td className="py-2">
                      <Checkbox
                        checked={selected.has(group.requestId)}
                        onCheckedChange={(checked) => {
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (checked) next.add(group.requestId);
                            else next.delete(group.requestId);
                            return next;
                          });
                        }}
                      />
                    </td>
                  )}
                  <td className="py-2 pr-3">
                    <Badge variant={KIND_VARIANT[group.kind]}>{KIND_LABEL[group.kind]}</Badge>
                  </td>
                  <td className="py-2 pr-3">
                    {KIND_LABEL[group.kind]} for {group.label} ({group.itemCount} pending)
                    {" · "}
                    <Link href={group.gridHref} className="text-primary underline">
                      View &amp; edit
                    </Link>
                    {rejectingRequestId === group.requestId && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <Input
                          placeholder="Reason for rejecting the whole roster"
                          value={rejectionReason}
                          onChange={(e) => setRejectionReason(e.target.value)}
                          className="max-w-xs"
                        />
                        <Button
                          type="button"
                          size="sm"
                          disabled={!rejectionReason.trim() || actingKey === group.requestId}
                          onClick={() => handleRejectGroup(group)}
                        >
                          Confirm reject
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => setRejectingRequestId(null)}>
                          Cancel
                        </Button>
                      </div>
                    )}
                  </td>
                  {canAct && (
                    <td className="py-2 pr-0">
                      <div className="flex justify-end gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          disabled={actingKey === group.requestId}
                          onClick={() => handleApproveGroup(group)}
                        >
                          {actingKey === group.requestId ? "Approving…" : `Approve (${group.itemCount})`}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={actingKey === group.requestId}
                          onClick={() => {
                            setRejectingRequestId(rejectingRequestId === group.requestId ? null : group.requestId);
                            setRejectionReason("");
                          }}
                        >
                          Reject
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  },
);
