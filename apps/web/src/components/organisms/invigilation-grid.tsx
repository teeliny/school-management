"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DndContext, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import { apiFetch, ApiError } from "../../lib/api";
import { Badge } from "../atoms/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";
import { cn } from "../../lib/cn";

type ApprovalStatus = "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "REJECTED";
type Role = "LEAD" | "ASSISTANT";

interface InvigilationAssignmentItem {
  id: string;
  examScheduleId: string;
  staffId: string;
  role: Role;
  approvalStatus: ApprovalStatus;
  examSchedule: { date: string; startTime: string; endTime: string; classArm: { displayName: string }; subject: { name: string } };
  staff: { user: { firstName: string; lastName: string } };
}
interface StaffOption {
  id: string;
  user: { firstName: string; lastName: string };
}

function staffName(u: { firstName: string; lastName: string }) {
  return `${u.firstName} ${u.lastName}`;
}

function DroppableCell({ cellId, children }: { cellId: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: cellId });
  return (
    <div ref={setNodeRef} className={cn("rounded-lg border border-dashed border-transparent p-0.5", isOver && "border-primary bg-primary/5")}>
      {children}
    </div>
  );
}

/**
 * BUILD_PLAN.md §9 Step 6e: unlike class/exam timetable's "move a card to a
 * different time slot" grids, InvigilationAssignment rows are fixed
 * one-per-(examSchedule, role) by a DB @@unique constraint — every cell is
 * always occupied. Dragging therefore swaps two assignments' staffId
 * values (via the transactional PATCH .../swap) instead of moving a card
 * into an empty cell; neither row's own (examScheduleId, role) identity
 * ever changes, so the @@unique constraint is never at risk. The inline
 * Select is a plain single-row PATCH — the simpler, non-swap reassignment
 * path. Approval and rejection are both single, whole-roster actions from
 * the Generate & Approve tab (Super-Admin only) — a pending card here just
 * shows a read-only "Pending" badge.
 */
export function InvigilationGrid({
  assessmentComponentId,
  canManage,
}: {
  assessmentComponentId: string;
  canManage: boolean;
}) {
  const [rows, setRows] = useState<InvigilationAssignmentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [fieldStatus, setFieldStatus] = useState<Record<string, "saving" | "saved" | "error">>({});

  const load = useCallback(() => {
    if (!assessmentComponentId) {
      setRows(null);
      return;
    }
    const qs = `assessmentComponentId=${assessmentComponentId}`;
    Promise.allSettled([
      apiFetch<InvigilationAssignmentItem[]>(`/invigilation-assignments?${qs}`, { auth: true }),
      apiFetch<InvigilationAssignmentItem[]>(`/invigilation-assignments?${qs}&approvalStatus=PENDING_REVIEW`, { auth: true }),
    ]).then(([approvedR, pendingR]) => {
      if (approvedR.status === "rejected" && pendingR.status === "rejected") {
        setError(approvedR.reason instanceof ApiError ? approvedR.reason.message : "Failed to load invigilation roster");
        return;
      }
      setError(null);
      const approved = approvedR.status === "fulfilled" ? approvedR.value : [];
      const pending = pendingR.status === "fulfilled" ? pendingR.value : [];
      setRows([...approved, ...pending]);
    });
  }, [assessmentComponentId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!canManage) return;
    // Principal/Headteacher hold this step's "manage invigilation" grant
    // but NOT StaffProfile read access (a separate, pre-existing CASL
    // boundary this step doesn't touch) — 403s here are expected for them,
    // not a bug; the Select still works for staff already visible in the
    // loaded rows (merged in staffSelectOptions below), just not for
    // picking someone new who isn't already assigned to anything in view.
    apiFetch<StaffOption[]>("/staff-profiles", { auth: true }).then(setStaffOptions).catch(() => setStaffOptions([]));
  }, [canManage]);

  const staffSelectOptions = useMemo(() => {
    const byId = new Map(staffOptions.map((s) => [s.id, s]));
    for (const row of rows ?? []) {
      if (!byId.has(row.staffId)) byId.set(row.staffId, { id: row.staffId, user: row.staff.user });
    }
    return [...byId.values()];
  }, [staffOptions, rows]);

  const examIds = useMemo(() => {
    if (!rows) return [];
    const seen = new Map<string, { date: string; startTime: string; endTime: string; subject: string; classArm: string }>();
    for (const row of rows) {
      if (!seen.has(row.examScheduleId)) {
        seen.set(row.examScheduleId, {
          date: row.examSchedule.date,
          startTime: row.examSchedule.startTime,
          endTime: row.examSchedule.endTime,
          subject: row.examSchedule.subject.name,
          classArm: row.examSchedule.classArm.displayName,
        });
      }
    }
    return [...seen.entries()].sort(
      ([, a], [, b]) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.startTime.localeCompare(b.startTime),
    );
  }, [rows]);

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || !rows) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;
    setActionError(null);
    try {
      await apiFetch(`/invigilation-assignments/${activeId}/swap`, { method: "PATCH", auth: true, body: { withId: overId } });
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Failed to swap — one side may already be double-booked");
    }
  }

  async function saveStaff(row: InvigilationAssignmentItem, staffId: string) {
    setFieldStatus((s) => ({ ...s, [row.id]: "saving" }));
    try {
      await apiFetch(`/invigilation-assignments/${row.id}`, { method: "PATCH", auth: true, body: { staffId } });
      setFieldStatus((s) => ({ ...s, [row.id]: "saved" }));
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Failed to save change");
      setFieldStatus((s) => ({ ...s, [row.id]: "error" }));
    }
  }

  if (!assessmentComponentId) return <p className="text-sm text-muted">Select an assessment component to view its invigilation roster.</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!rows) return <p className="text-sm text-muted">Loading…</p>;
  if (examIds.length === 0) {
    return <p className="text-sm text-muted">{canManage ? "No invigilation roster yet for this component." : "No invigilation roster published yet."}</p>;
  }

  return (
    <div className="space-y-2">
      {actionError && <p className="text-[12.5px] text-danger">{actionError}</p>}
      <DndContext onDragEnd={handleDragEnd}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-border text-[10.5px] uppercase tracking-wide text-muted">
                <th className="py-2 pr-3 font-medium">Date</th>
                <th className="py-2 pr-3 font-medium">Time</th>
                <th className="py-2 pr-3 font-medium">Subject</th>
                <th className="py-2 pr-3 font-medium">Class</th>
                <th className="py-2 pr-3 font-medium">Lead</th>
                <th className="py-2 pr-0 font-medium">Assistant</th>
              </tr>
            </thead>
            <tbody>
              {examIds.map(([examScheduleId, info]) => {
                const lead = rows.find((r) => r.examScheduleId === examScheduleId && r.role === "LEAD");
                const assistant = rows.find((r) => r.examScheduleId === examScheduleId && r.role === "ASSISTANT");
                return (
                  <tr key={examScheduleId} className="border-b border-border align-top">
                    <td className="py-2 pr-3">{new Date(info.date).toLocaleDateString()}</td>
                    <td className="py-2 pr-3 font-mono">
                      {info.startTime}–{info.endTime}
                    </td>
                    <td className="py-2 pr-3">{info.subject}</td>
                    <td className="py-2 pr-3">{info.classArm}</td>
                    <td className="min-w-[220px] py-2 pr-3">
                      {lead && (
                        <DroppableCell cellId={lead.id}>
                          <AssignmentCard
                            row={lead}
                            canManage={canManage}
                            staffOptions={staffSelectOptions}
                            fieldStatus={fieldStatus[lead.id]}
                            onStaffChange={(staffId) => saveStaff(lead, staffId)}
                          />
                        </DroppableCell>
                      )}
                    </td>
                    <td className="min-w-[220px] py-2 pr-0">
                      {assistant && (
                        <DroppableCell cellId={assistant.id}>
                          <AssignmentCard
                            row={assistant}
                            canManage={canManage}
                            staffOptions={staffSelectOptions}
                            fieldStatus={fieldStatus[assistant.id]}
                            onStaffChange={(staffId) => saveStaff(assistant, staffId)}
                          />
                        </DroppableCell>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </DndContext>
    </div>
  );
}

function AssignmentCard({
  row,
  canManage,
  staffOptions,
  fieldStatus,
  onStaffChange,
}: {
  row: InvigilationAssignmentItem;
  canManage: boolean;
  staffOptions: StaffOption[];
  fieldStatus?: "saving" | "saved" | "error";
  onStaffChange: (staffId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: row.id });
  const pending = row.approvalStatus === "PENDING_REVIEW";

  return (
    <div
      ref={setNodeRef}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 10 } : undefined}
      className={cn(
        "relative rounded-lg border bg-card-inset p-2 text-[11.5px]",
        pending ? "border-dashed border-warning" : "border-border",
        isDragging && "opacity-60 shadow-md",
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-1">
        {pending && (
          <Badge variant="warning" className="text-[9px]">
            Pending
          </Badge>
        )}
        {canManage && (
          <button
            type="button"
            aria-label="Drag to swap"
            className="ml-auto cursor-grab touch-none text-muted active:cursor-grabbing"
            {...listeners}
            {...attributes}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {canManage ? (
        <div className="space-y-1">
          <Select value={row.staffId} onValueChange={onStaffChange}>
            <SelectTrigger className="h-7 px-1.5 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {staffOptions.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {staffName(s.user)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fieldStatus === "saving" && <span className="text-[10px] text-muted">Saving…</span>}
          {fieldStatus === "error" && <span className="text-[10px] text-danger">Failed to save</span>}
        </div>
      ) : (
        <div className="font-medium">{staffName(row.staff.user)}</div>
      )}
    </div>
  );
}
