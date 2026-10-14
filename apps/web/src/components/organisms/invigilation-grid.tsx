"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DndContext, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import { formatPersonName } from "@school/types";
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
  examSchedule: {
    date: string;
    startTime: string;
    endTime: string;
    classArmId: string;
    classArm: { displayName: string };
    subject: { name: string };
  };
  staff: { user: { firstName: string; lastName: string } };
}
// Mixed-hall duty (ExamDayInvigilation): N invigilators for the whole hall
// per exam day, not tied to a single paper or class.
interface HallDutyItem {
  id: string;
  date: string;
  staffId: string;
  approvalStatus: ApprovalStatus;
  staff: { user: { firstName: string; lastName: string } };
}
interface StaffOption {
  id: string;
  user: { firstName: string; lastName: string };
}

// One class arm's invigilation for one exam day — every paper it sits that
// day, with the rows for each role (normally all held by one person: the
// solver assigns per arm per day, CLASS_TEACHER mode per arm).
interface ClassDayGroup {
  key: string;
  classArm: string;
  papers: { subject: string; startTime: string; endTime: string }[];
  byRole: Record<Role, InvigilationAssignmentItem[]>;
}
interface ExamDay {
  date: string;
  hall: HallDutyItem[];
  classes: ClassDayGroup[];
}

const dayKey = (iso: string) => iso.slice(0, 10);
const formatDay = (key: string) =>
  new Date(`${key}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short", year: "numeric" });
const roleCellId = (groupKey: string, role: Role) => `${groupKey}|${role}`;

function DroppableCell({ cellId, children }: { cellId: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: cellId });
  return (
    <div ref={setNodeRef} className={cn("rounded-lg border border-dashed border-transparent p-0.5", isOver && "border-primary bg-primary/5")}>
      {children}
    </div>
  );
}

/**
 * The roster, grouped per exam day. Mixed-hall sittings (JSS/SSS exam, Basic
 * exam) are just a list of hall invigilators for the day — no classes, since
 * they aren't tied to one. Per-class sittings list each class arm sitting
 * that day with its invigilator(s), one row per arm covering all its papers.
 *
 * Reassigning a class row (Select) or dragging one class's invigilator onto
 * another's (swap) moves every paper row in the group at once, via the
 * transactional PATCH .../reassign and .../swap-groups. Approval and
 * rejection are whole-roster actions from the Generate & Approve tab — a
 * pending card here just shows a read-only "Pending" badge.
 */
export function InvigilationGrid({
  assessmentComponentId,
  canManage,
}: {
  assessmentComponentId: string;
  canManage: boolean;
}) {
  const [rows, setRows] = useState<InvigilationAssignmentItem[] | null>(null);
  const [hallRows, setHallRows] = useState<HallDutyItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [excludedStaffIds, setExcludedStaffIds] = useState<Set<string>>(new Set());
  const [fieldStatus, setFieldStatus] = useState<Record<string, "saving" | "saved" | "error">>({});

  const load = useCallback(() => {
    if (!assessmentComponentId) {
      setRows(null);
      return;
    }
    const qs = `assessmentComponentId=${assessmentComponentId}`;
    Promise.allSettled([
      apiFetch<HallDutyItem[]>(`/exam-day-invigilations?${qs}`, { auth: true }),
      apiFetch<HallDutyItem[]>(`/exam-day-invigilations?${qs}&approvalStatus=PENDING_REVIEW`, { auth: true }),
    ]).then((results) => setHallRows(results.flatMap((r) => (r.status === "fulfilled" ? r.value : []))));
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
    // Super-Admin/Bursar never invigilate (the API rejects them too) — keep
    // them out of the pickers.
    apiFetch<string[]>("/invigilation-assignments/excluded-staff", { auth: true })
      .then((ids) => setExcludedStaffIds(new Set(ids)))
      .catch(() => setExcludedStaffIds(new Set()));
  }, [canManage]);

  const staffSelectOptions = useMemo(() => {
    const byId = new Map(staffOptions.map((s) => [s.id, s]));
    for (const row of [...(rows ?? []), ...hallRows]) {
      if (!byId.has(row.staffId)) byId.set(row.staffId, { id: row.staffId, user: row.staff.user });
    }
    return [...byId.values()]
      .filter((s) => !excludedStaffIds.has(s.id))
      .sort((a, b) => formatPersonName(a.user).localeCompare(formatPersonName(b.user)));
  }, [staffOptions, rows, hallRows, excludedStaffIds]);

  // The current holder stays selectable even if excluded (an older roster),
  // so the trigger can still show their name until someone reassigns it.
  const optionsFor = useCallback(
    (current: { staffId: string; staff: { user: StaffOption["user"] } } | undefined) =>
      current && !staffSelectOptions.some((s) => s.id === current.staffId)
        ? [{ id: current.staffId, user: current.staff.user }, ...staffSelectOptions]
        : staffSelectOptions,
    [staffSelectOptions],
  );

  const examDays = useMemo<ExamDay[]>(() => {
    const days = new Map<string, ExamDay>();
    const dayFor = (key: string) => {
      let day = days.get(key);
      if (!day) {
        day = { date: key, hall: [], classes: [] };
        days.set(key, day);
      }
      return day;
    };
    for (const row of hallRows) dayFor(dayKey(row.date)).hall.push(row);

    const groups = new Map<string, ClassDayGroup>();
    const seenPapers = new Set<string>();
    for (const row of rows ?? []) {
      const date = dayKey(row.examSchedule.date);
      const key = `${date}|${row.examSchedule.classArmId}`;
      let group = groups.get(key);
      if (!group) {
        group = { key, classArm: row.examSchedule.classArm.displayName, papers: [], byRole: { LEAD: [], ASSISTANT: [] } };
        groups.set(key, group);
        dayFor(date).classes.push(group);
      }
      group.byRole[row.role].push(row);
      if (!seenPapers.has(row.examScheduleId)) {
        seenPapers.add(row.examScheduleId);
        group.papers.push({ subject: row.examSchedule.subject.name, startTime: row.examSchedule.startTime, endTime: row.examSchedule.endTime });
      }
    }
    for (const day of days.values()) {
      day.classes.sort((a, b) => a.classArm.localeCompare(b.classArm, undefined, { numeric: true }));
      for (const group of day.classes) group.papers.sort((a, b) => a.startTime.localeCompare(b.startTime));
    }
    return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [rows, hallRows]);

  const hasAssistants = useMemo(() => (rows ?? []).some((r) => r.role === "ASSISTANT"), [rows]);
  const groupsByCellId = useMemo(() => {
    const map = new Map<string, InvigilationAssignmentItem[]>();
    for (const day of examDays) {
      for (const group of day.classes) {
        for (const role of ["LEAD", "ASSISTANT"] as const) {
          if (group.byRole[role].length > 0) map.set(roleCellId(group.key, role), group.byRole[role]);
        }
      }
    }
    return map;
  }, [examDays]);

  async function saveHallStaff(row: HallDutyItem, staffId: string) {
    setActionError(null);
    setFieldStatus((s) => ({ ...s, [row.id]: "saving" }));
    try {
      await apiFetch(`/exam-day-invigilations/${row.id}`, { method: "PATCH", auth: true, body: { staffId } });
      setFieldStatus((s) => ({ ...s, [row.id]: "saved" }));
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Failed to save change");
      setFieldStatus((s) => ({ ...s, [row.id]: "error" }));
    }
  }

  async function saveGroupStaff(cellId: string, groupRows: InvigilationAssignmentItem[], staffId: string) {
    setActionError(null);
    setFieldStatus((s) => ({ ...s, [cellId]: "saving" }));
    try {
      await apiFetch("/invigilation-assignments/reassign", {
        method: "PATCH",
        auth: true,
        body: { ids: groupRows.map((r) => r.id), staffId },
      });
      setFieldStatus((s) => ({ ...s, [cellId]: "saved" }));
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Failed to save change");
      setFieldStatus((s) => ({ ...s, [cellId]: "error" }));
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;
    const groupA = groupsByCellId.get(activeId);
    const groupB = groupsByCellId.get(overId);
    if (!groupA || !groupB) return;
    setActionError(null);
    try {
      await apiFetch("/invigilation-assignments/swap-groups", {
        method: "PATCH",
        auth: true,
        body: { idsA: groupA.map((r) => r.id), idsB: groupB.map((r) => r.id) },
      });
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Failed to swap — one side may already be double-booked");
    }
  }

  if (!assessmentComponentId) return <p className="text-sm text-muted">Select an assessment component to view its invigilation roster.</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!rows) return <p className="text-sm text-muted">Loading…</p>;
  if (examDays.length === 0) {
    return <p className="text-sm text-muted">{canManage ? "No invigilation roster yet for this component." : "No invigilation roster published yet."}</p>;
  }

  return (
    <DndContext onDragEnd={handleDragEnd}>
      <div className="space-y-3">
        <div className="flex items-center justify-end">
          <a
            href={`/api/proxy/invigilation-assignments/pdf?assessmentComponentId=${assessmentComponentId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11.5px] text-primary underline"
          >
            Download PDF
          </a>
        </div>
        {actionError && <p className="text-[12.5px] text-danger">{actionError}</p>}
        {examDays.map((day) => (
          <section key={day.date} className="rounded-lg border border-border bg-card-inset px-4 py-3">
            <h4 className="mb-2 font-display text-[14px] font-semibold">{formatDay(day.date)}</h4>

            {day.hall.length > 0 && (
              <div className={cn(day.classes.length > 0 && "mb-3")}>
                <p className="mb-1.5 text-[11.5px] text-muted">Exam hall invigilators, on duty for every paper in the hall</p>
                <div className="flex flex-wrap gap-2">
                  {day.hall.map((row) => (
                    <div
                      key={row.id}
                      className={cn(
                        "min-w-[200px] rounded-lg border bg-card p-2 text-[11.5px]",
                        row.approvalStatus === "PENDING_REVIEW" ? "border-dashed border-warning" : "border-border",
                      )}
                    >
                      {row.approvalStatus === "PENDING_REVIEW" && (
                        <Badge variant="warning" className="mb-1 text-[9px]">
                          Pending
                        </Badge>
                      )}
                      {canManage ? (
                        <StaffSelect value={row.staffId} options={optionsFor(row)} onChange={(staffId) => saveHallStaff(row, staffId)} />
                      ) : (
                        <div className="font-medium">{formatPersonName(row.staff.user)}</div>
                      )}
                      {fieldStatus[row.id] === "error" && <span className="text-[10px] text-danger">Failed to save</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {day.classes.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12.5px]">
                  <thead>
                    <tr className="border-b border-border text-[10.5px] uppercase tracking-wide text-muted">
                      <th className="py-2 pr-3 font-medium">Class</th>
                      <th className="py-2 pr-3 font-medium">{hasAssistants ? "Lead" : "Invigilator"}</th>
                      {hasAssistants && <th className="py-2 pr-0 font-medium">Assistant</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {day.classes.map((group) => (
                      <tr key={group.key} className="border-b border-border align-top last:border-b-0">
                        <td className="py-2 pr-3">
                          <div className="font-medium">{group.classArm}</div>
                          <div className="mt-0.5 text-[11px] text-muted">
                            {group.papers.map((p) => `${p.subject} (${p.startTime}–${p.endTime})`).join(" · ")}
                          </div>
                        </td>
                        {(hasAssistants ? (["LEAD", "ASSISTANT"] as const) : (["LEAD"] as const)).map((role) => {
                          const groupRows = group.byRole[role];
                          const cellId = roleCellId(group.key, role);
                          return (
                            <td key={role} className="min-w-[220px] py-2 pr-3 last:pr-0">
                              {groupRows.length > 0 && (
                                <DroppableCell cellId={cellId}>
                                  <AssignmentCard
                                    cellId={cellId}
                                    rows={groupRows}
                                    canManage={canManage}
                                    staffOptions={optionsFor(groupRows[0])}
                                    fieldStatus={fieldStatus[cellId]}
                                    onStaffChange={(staffId) => saveGroupStaff(cellId, groupRows, staffId)}
                                  />
                                </DroppableCell>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))}
      </div>
    </DndContext>
  );
}

function StaffSelect({
  value,
  options,
  onChange,
  placeholder,
}: {
  value: string;
  options: StaffOption[];
  onChange: (staffId: string) => void;
  placeholder?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-7 px-1.5 text-[11px]">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {formatPersonName(s.user)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AssignmentCard({
  cellId,
  rows,
  canManage,
  staffOptions,
  fieldStatus,
  onStaffChange,
}: {
  cellId: string;
  rows: InvigilationAssignmentItem[];
  canManage: boolean;
  staffOptions: StaffOption[];
  fieldStatus?: "saving" | "saved" | "error";
  onStaffChange: (staffId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: cellId });
  const pending = rows.some((r) => r.approvalStatus === "PENDING_REVIEW");
  // Normally one person covers the class all day; a hand-edited older roster
  // may still differ per paper — picking someone here unifies it.
  const holders = [...new Map(rows.map((r) => [r.staffId, r.staff.user])).entries()];
  const single = holders.length === 1 ? holders[0]![0] : "";

  return (
    <div
      ref={setNodeRef}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 10 } : undefined}
      className={cn(
        "relative rounded-lg border bg-card p-2 text-[11.5px]",
        pending ? "border-dashed border-warning" : "border-border",
        isDragging && "opacity-60 shadow-md",
      )}
    >
      {(pending || canManage) && (
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
      )}

      {canManage ? (
        <div className="space-y-1">
          <StaffSelect
            value={single}
            options={staffOptions}
            onChange={onStaffChange}
            placeholder={holders.map(([, user]) => formatPersonName(user)).join(" / ")}
          />
          {fieldStatus === "saving" && <span className="text-[10px] text-muted">Saving…</span>}
          {fieldStatus === "error" && <span className="text-[10px] text-danger">Failed to save</span>}
        </div>
      ) : (
        <div className="font-medium">{holders.map(([, user]) => formatPersonName(user)).join(" / ")}</div>
      )}
    </div>
  );
}
