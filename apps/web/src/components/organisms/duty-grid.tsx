"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DndContext, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import { apiFetch, ApiError } from "../../lib/api";
import { Badge } from "../atoms/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";
import { cn } from "../../lib/cn";

type ApprovalStatus = "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "REJECTED";
type ClassLevelCategoryGroup = "JSS_SSS" | "CRECHE_NURSERY_PRIMARY";

interface DutyAssignmentItem {
  id: string;
  weekStartDate: string;
  classLevelCategoryGroup: ClassLevelCategoryGroup;
  staffId: string;
  approvalStatus: ApprovalStatus;
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
 * BUILD_PLAN.md §9 Step 6f: like InvigilationAssignment, DutyAssignment rows
 * are always fully occupied (the generator always produces exactly
 * teachersPerWeek rows/week), so dragging swaps two assignments' staffId
 * values rather than moving a card into an empty cell. It differs from
 * invigilation in having no fixed role pairing — a week just holds however
 * many symmetric peer slots share its weekStartDate — so there's no fixed
 * column count, only one flex-wrapped cell per week. Approval and rejection
 * are both single, whole-roster actions from the Generate & Approve tab
 * (Super-Admin only) — a pending card here just shows a read-only "Pending"
 * badge.
 */
export function DutyGrid({
  classLevelCategoryGroup,
  weekStartDateFrom,
  weekStartDateTo,
  canManage,
}: {
  classLevelCategoryGroup: ClassLevelCategoryGroup;
  weekStartDateFrom: string;
  weekStartDateTo: string;
  canManage: boolean;
}) {
  const [rows, setRows] = useState<DutyAssignmentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [fieldStatus, setFieldStatus] = useState<Record<string, "saving" | "saved" | "error">>({});

  const load = useCallback(() => {
    if (!classLevelCategoryGroup || !weekStartDateFrom || !weekStartDateTo) {
      setRows(null);
      return;
    }
    const qs = `classLevelCategoryGroup=${classLevelCategoryGroup}&weekStartDateFrom=${weekStartDateFrom}&weekStartDateTo=${weekStartDateTo}`;
    Promise.allSettled([
      apiFetch<DutyAssignmentItem[]>(`/duty-assignments?${qs}`, { auth: true }),
      apiFetch<DutyAssignmentItem[]>(`/duty-assignments?${qs}&approvalStatus=PENDING_REVIEW`, { auth: true }),
    ]).then(([approvedR, pendingR]) => {
      if (approvedR.status === "rejected" && pendingR.status === "rejected") {
        setError(approvedR.reason instanceof ApiError ? approvedR.reason.message : "Failed to load duty roster");
        return;
      }
      setError(null);
      const approved = approvedR.status === "fulfilled" ? approvedR.value : [];
      const pending = pendingR.status === "fulfilled" ? pendingR.value : [];
      setRows([...approved, ...pending]);
    });
  }, [classLevelCategoryGroup, weekStartDateFrom, weekStartDateTo]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!canManage) return;
    // Same pre-existing Principal/Headteacher StaffProfile-read gap as
    // invigilation-grid.tsx — 403s here are expected, not a bug; the Select
    // still works for staff already visible in the loaded rows.
    apiFetch<StaffOption[]>("/staff-profiles", { auth: true }).then(setStaffOptions).catch(() => setStaffOptions([]));
  }, [canManage]);

  const staffSelectOptions = useMemo(() => {
    const byId = new Map(staffOptions.map((s) => [s.id, s]));
    for (const row of rows ?? []) {
      if (!byId.has(row.staffId)) byId.set(row.staffId, { id: row.staffId, user: row.staff.user });
    }
    return [...byId.values()];
  }, [staffOptions, rows]);

  const weeks = useMemo(() => {
    if (!rows) return [];
    const byWeek = new Map<string, DutyAssignmentItem[]>();
    for (const row of rows) {
      const list = byWeek.get(row.weekStartDate) ?? [];
      list.push(row);
      byWeek.set(row.weekStartDate, list);
    }
    return [...byWeek.entries()].sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime());
  }, [rows]);

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || !rows) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;
    setActionError(null);
    try {
      await apiFetch(`/duty-assignments/${activeId}/swap`, { method: "PATCH", auth: true, body: { withId: overId } });
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Failed to swap — one side may already hold a slot that week");
    }
  }

  async function saveStaff(row: DutyAssignmentItem, staffId: string) {
    setFieldStatus((s) => ({ ...s, [row.id]: "saving" }));
    try {
      await apiFetch(`/duty-assignments/${row.id}`, { method: "PATCH", auth: true, body: { staffId } });
      setFieldStatus((s) => ({ ...s, [row.id]: "saved" }));
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Failed to save change");
      setFieldStatus((s) => ({ ...s, [row.id]: "error" }));
    }
  }

  if (!classLevelCategoryGroup || !weekStartDateFrom || !weekStartDateTo) {
    return <p className="text-sm text-muted">Select a class-level group and term to view the weekly duty roster.</p>;
  }
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!rows) return <p className="text-sm text-muted">Loading…</p>;
  if (weeks.length === 0) {
    return <p className="text-sm text-muted">{canManage ? "No duty roster yet for this term." : "No duty roster published yet."}</p>;
  }

  return (
    <div className="space-y-2">
      {actionError && <p className="text-[12.5px] text-danger">{actionError}</p>}
      <DndContext onDragEnd={handleDragEnd}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-border text-[10.5px] uppercase tracking-wide text-muted">
                <th className="py-2 pr-3 font-medium">Week of</th>
                <th className="py-2 pr-0 font-medium">On duty</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map(([weekStartDate, weekRows]) => (
                <tr key={weekStartDate} className="border-b border-border align-top">
                  <td className="whitespace-nowrap py-2 pr-3">{new Date(weekStartDate).toLocaleDateString()}</td>
                  <td className="py-2 pr-0">
                    <div className="flex flex-wrap gap-2">
                      {weekRows.map((row) => (
                        <div key={row.id} className="w-[220px]">
                          <DroppableCell cellId={row.id}>
                            <AssignmentCard
                              row={row}
                              canManage={canManage}
                              staffOptions={staffSelectOptions}
                              fieldStatus={fieldStatus[row.id]}
                              onStaffChange={(staffId) => saveStaff(row, staffId)}
                            />
                          </DroppableCell>
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
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
  row: DutyAssignmentItem;
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
