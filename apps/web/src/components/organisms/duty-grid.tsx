"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DndContext, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import { formatPersonName } from "@school/types";
import { apiFetch, ApiError } from "../../lib/api";
import { Badge } from "../atoms/badge";
import { Button } from "../atoms/button";
import { Input } from "../atoms/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";
import { cn } from "../../lib/cn";
import { DutyRosterGenerateForm } from "./duty-roster-generate-form";

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
interface DutyRosterWeekItem {
  id: string;
  weekStartDate: string;
  topic: string | null;
  isBreak: boolean;
}
interface StaffOption {
  id: string;
  user: { firstName: string; lastName: string };
}

// The DutyRosterWeek row backing a given week (topic/break status), if the
// roster was built via the manual generator — an AI (OR-Tools) run has no
// such entity, so this is `undefined` for a week that only has
// DutyAssignment rows.
interface WeekGroup {
  weekStartDate: string;
  rosterWeek?: DutyRosterWeekItem;
  assignments: DutyAssignmentItem[];
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
  termId,
  weekStartDateFrom,
  weekStartDateTo,
  canManage,
  canGenerate,
}: {
  classLevelCategoryGroup: ClassLevelCategoryGroup;
  // Only needed to fetch/generate the manual roster's DutyRosterWeek rows
  // (topics, break weeks) — the date-range props below still drive the
  // DutyAssignment fetch, same as before.
  termId?: string;
  weekStartDateFrom: string;
  weekStartDateTo: string;
  canManage: boolean;
  canGenerate?: boolean;
}) {
  const [rows, setRows] = useState<DutyAssignmentItem[] | null>(null);
  const [rosterWeeks, setRosterWeeks] = useState<DutyRosterWeekItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [fieldStatus, setFieldStatus] = useState<Record<string, "saving" | "saved" | "error">>({});
  const [confirmingBreak, setConfirmingBreak] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!classLevelCategoryGroup || !weekStartDateFrom || !weekStartDateTo) {
      setRows(null);
      setRosterWeeks(null);
      return;
    }
    const qs = `classLevelCategoryGroup=${classLevelCategoryGroup}&weekStartDateFrom=${weekStartDateFrom}&weekStartDateTo=${weekStartDateTo}`;
    Promise.allSettled([
      apiFetch<DutyAssignmentItem[]>(`/duty-assignments?${qs}`, { auth: true }),
      apiFetch<DutyAssignmentItem[]>(`/duty-assignments?${qs}&approvalStatus=PENDING_REVIEW`, { auth: true }),
      termId
        ? apiFetch<DutyRosterWeekItem[]>(
            `/duty-roster-weeks?termId=${termId}&classLevelCategoryGroup=${classLevelCategoryGroup}`,
            { auth: true },
          )
        : Promise.resolve([] as DutyRosterWeekItem[]),
    ]).then(([approvedR, pendingR, rosterWeeksR]) => {
      if (approvedR.status === "rejected" && pendingR.status === "rejected") {
        setError(approvedR.reason instanceof ApiError ? approvedR.reason.message : "Failed to load duty roster");
        return;
      }
      setError(null);
      const approved = approvedR.status === "fulfilled" ? approvedR.value : [];
      const pending = pendingR.status === "fulfilled" ? pendingR.value : [];
      setRows([...approved, ...pending]);
      setRosterWeeks(rosterWeeksR.status === "fulfilled" ? rosterWeeksR.value : []);
    });
  }, [classLevelCategoryGroup, termId, weekStartDateFrom, weekStartDateTo]);

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

  // DutyRosterWeek (manual roster builder) is the master week list when it
  // exists — it's the only source that knows about break weeks and weeks
  // with a topic but (not yet) any assignments. Falls back to deriving
  // weeks straight from DutyAssignment rows for an AI (OR-Tools) roster,
  // which has no DutyRosterWeek entity at all.
  const weeks = useMemo((): WeekGroup[] => {
    if (!rows) return [];
    const byWeek = new Map<string, DutyAssignmentItem[]>();
    for (const row of rows) {
      const key = row.weekStartDate.slice(0, 10);
      const list = byWeek.get(key) ?? [];
      list.push(row);
      byWeek.set(key, list);
    }

    // Union, not either/or — an AI-generated roster has DutyAssignment rows
    // but no DutyRosterWeek entries at all (until someone sets a topic on
    // one, see saveTopic below, at which point it gains exactly one); a
    // manually-generated roster can have a DutyRosterWeek with zero
    // assignments (a break week). Keyed by date-only string since the API
    // returns full ISO datetimes for both.
    const byRosterWeek = new Map((rosterWeeks ?? []).map((rw) => [rw.weekStartDate.slice(0, 10), rw]));
    const allKeys = new Set([...byWeek.keys(), ...byRosterWeek.keys()]);
    return [...allKeys]
      .map((key) => {
        const rosterWeek = byRosterWeek.get(key);
        return {
          weekStartDate: rosterWeek?.weekStartDate ?? byWeek.get(key)![0]!.weekStartDate,
          rosterWeek,
          assignments: byWeek.get(key) ?? [],
        };
      })
      .sort((a, b) => new Date(a.weekStartDate).getTime() - new Date(b.weekStartDate).getTime());
  }, [rows, rosterWeeks]);

  // Always upserts by natural key (termId/classLevelCategoryGroup/
  // weekStartDate) rather than a DutyRosterWeek id — works the same whether
  // this week already has a DutyRosterWeek row (a manually-generated
  // roster) or not (an AI-generated one, which creates it on first edit).
  async function saveWeek(week: WeekGroup, patch: { topic?: string; isBreak?: boolean }) {
    if (!termId) return;
    const statusKey = week.weekStartDate;
    setFieldStatus((s) => ({ ...s, [statusKey]: "saving" }));
    try {
      await apiFetch("/duty-roster-weeks/upsert", {
        method: "POST",
        auth: true,
        body: { termId, classLevelCategoryGroup, weekStartDate: week.weekStartDate.slice(0, 10), ...patch },
      });
      setFieldStatus((s) => ({ ...s, [statusKey]: "saved" }));
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Failed to save change");
      setFieldStatus((s) => ({ ...s, [statusKey]: "error" }));
    }
  }

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
    if (canGenerate && termId) {
      return <DutyRosterGenerateForm termId={termId} classLevelCategoryGroup={classLevelCategoryGroup} onGenerated={load} />;
    }
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
                <th className="py-2 pr-3 font-medium">Week</th>
                <th className="py-2 pr-3 font-medium">Week of</th>
                <th className="py-2 pr-3 font-medium">On duty</th>
                <th className="py-2 pr-3 font-medium">Topic</th>
                {canManage && termId && <th className="py-2 pr-0 font-medium" />}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week, index) =>
                week.rosterWeek?.isBreak ? (
                  <tr key={week.weekStartDate} className="border-b border-border align-top even:bg-card-inset">
                    <td className="whitespace-nowrap py-2 pr-3 font-medium">{index + 1}</td>
                    <td className="whitespace-nowrap py-2 pr-3">{new Date(week.weekStartDate).toLocaleDateString()}</td>
                    <td colSpan={canManage && termId ? 3 : 2} className="py-2 pr-0 text-muted">
                      <Badge variant="muted">Mid-Term Break</Badge>
                    </td>
                  </tr>
                ) : (
                  <tr key={week.weekStartDate} className="border-b border-border align-top even:bg-card-inset">
                    <td className="whitespace-nowrap py-2 pr-3 font-medium">{index + 1}</td>
                    <td className="whitespace-nowrap py-2 pr-3">{new Date(week.weekStartDate).toLocaleDateString()}</td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap gap-2">
                        {week.assignments.map((row) => (
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
                        {week.assignments.length === 0 && <span className="text-muted">No one assigned</span>}
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      <TopicCell
                        topic={week.rosterWeek?.topic ?? null}
                        canManage={canManage && Boolean(termId)}
                        fieldStatus={fieldStatus[week.weekStartDate]}
                        onSave={(topic) => saveWeek(week, { topic })}
                      />
                    </td>
                    {canManage && termId && (
                      <td className="py-2 pr-0">
                        {confirmingBreak === week.weekStartDate ? (
                          <div className="flex flex-col items-start gap-1">
                            <span className="text-[10.5px] text-danger">Clears assigned staff. Sure?</span>
                            <div className="flex gap-1.5">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-6 px-2 text-[10.5px]"
                                onClick={() => {
                                  setConfirmingBreak(null);
                                  saveWeek(week, { isBreak: true });
                                }}
                              >
                                Confirm
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-6 px-2 text-[10.5px]"
                                onClick={() => setConfirmingBreak(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 whitespace-nowrap text-[10.5px]"
                            onClick={() => setConfirmingBreak(week.weekStartDate)}
                          >
                            Mark as break
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ),
              )}
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
                  {formatPersonName(s.user)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fieldStatus === "saving" && <span className="text-[10px] text-muted">Saving…</span>}
          {fieldStatus === "error" && <span className="text-[10px] text-danger">Failed to save</span>}
        </div>
      ) : (
        <div className="font-medium">{formatPersonName(row.staff.user)}</div>
      )}
    </div>
  );
}

// Free-text, so it saves on blur rather than per keystroke — local `value`
// state re-syncs from the loaded week only when it actually differs (not
// while the input still has focus) so an in-flight edit doesn't get
// clobbered mid-typing by the next background refresh.
function TopicCell({
  topic,
  canManage,
  fieldStatus,
  onSave,
}: {
  topic: string | null;
  canManage: boolean;
  fieldStatus?: "saving" | "saved" | "error";
  onSave: (topic: string) => void;
}) {
  const [value, setValue] = useState(topic ?? "");
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setValue(topic ?? "");
  }, [topic, focused]);

  if (!canManage) {
    return <span>{topic || <span className="text-muted">Not set</span>}</span>;
  }

  return (
    <div className="min-w-[220px] space-y-1">
      <Input
        value={value}
        placeholder="e.g. Discipline and Self-Control"
        className="h-7 px-1.5 text-[11px]"
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          if (value !== (topic ?? "")) onSave(value);
        }}
      />
      {fieldStatus === "saving" && <span className="text-[10px] text-muted">Saving…</span>}
      {fieldStatus === "error" && <span className="text-[10px] text-danger">Failed to save</span>}
    </div>
  );
}
