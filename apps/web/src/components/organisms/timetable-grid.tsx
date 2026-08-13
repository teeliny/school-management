"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DndContext, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import { timeToMinutes } from "@school/types";
import { apiFetch, ApiError } from "../../lib/api";
import { Badge } from "../atoms/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";
import { cn } from "../../lib/cn";

type DayOfWeek = "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY";
type ApprovalStatus = "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "REJECTED";

interface TimetableSlotItem {
  id: string;
  dayOfWeek: DayOfWeek;
  startTime: string;
  endTime: string;
  venue: string | null;
  approvalStatus: ApprovalStatus;
  subjectId: string;
  staffId: string;
  subject: { name: string; code: string };
  staff: { user: { firstName: string; lastName: string } };
}
interface SubjectOption {
  id: string;
  name: string;
  code: string;
  isGroup: boolean;
  childSubjects?: { id: string; name: string; code: string }[];
}
interface StaffOption {
  id: string;
  user: { firstName: string; lastName: string };
}

const DAYS: DayOfWeek[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];
const DAY_LABELS: Record<DayOfWeek, string> = {
  MONDAY: "Mon",
  TUESDAY: "Tue",
  WEDNESDAY: "Wed",
  THURSDAY: "Thu",
  FRIDAY: "Fri",
};

function minutesToTime(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function cellKey(day: string, startTime: string) {
  return `${day}|${startTime}`;
}

function DroppableCell({ day, startTime, children }: { day: DayOfWeek; startTime: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: cellKey(day, startTime) });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-h-[70px] rounded-lg border border-dashed border-transparent p-0.5",
        isOver && "border-primary bg-primary/5",
      )}
    >
      {children}
    </div>
  );
}

/**
 * BUILD_PLAN.md §9 Step 6b: a real period(row) x day(column) grid — replaces
 * the previous day-only-stacked layout, since a fixed grid-of-cells is what
 * makes "drag a card into a cell" a coherent gesture (matches
 * docs/school-system-design.html's "By class" static mockup table, made
 * interactive). Row axis is derived client-side from the distinct
 * startTimes already present in the loaded slots — no dependency on
 * SchedulingConstraint's period-structure rows, no new backend lookup.
 * `canManage` gates drag/inline-edit (same grant TimetableSlotForm already
 * requires) — approval and rejection are both single, whole-roster actions
 * from the Generate & Approve tab (Super-Admin only), not per row here; a
 * pending card just shows a read-only "Pending" badge.
 */
export function TimetableGrid({
  classArmId,
  academicSessionId,
  termId,
  canManage,
  refreshKey,
}: {
  classArmId: string;
  academicSessionId: string;
  termId: string;
  canManage: boolean;
  refreshKey?: unknown;
}) {
  const [slots, setSlots] = useState<TimetableSlotItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [fieldStatus, setFieldStatus] = useState<Record<string, "saving" | "saved" | "error">>({});

  const load = useCallback(() => {
    if (!classArmId || !academicSessionId || !termId) {
      setSlots(null);
      return;
    }
    const qs = `classArmId=${classArmId}&academicSessionId=${academicSessionId}&termId=${termId}`;
    // Two calls, not one — the second (PENDING_REVIEW) 403s for a viewer who
    // can't manage the timetable, and that must not blank out the approved
    // grid they're otherwise allowed to see. Same allSettled-degrade
    // precedent as scheduling-approvals-queue.tsx.
    Promise.allSettled([
      apiFetch<TimetableSlotItem[]>(`/timetable-slots?${qs}`, { auth: true }),
      apiFetch<TimetableSlotItem[]>(`/timetable-slots?${qs}&approvalStatus=PENDING_REVIEW`, { auth: true }),
    ]).then(([approvedR, pendingR]) => {
      if (approvedR.status === "rejected" && pendingR.status === "rejected") {
        setError(approvedR.reason instanceof ApiError ? approvedR.reason.message : "Failed to load timetable");
        return;
      }
      setError(null);
      const approved = approvedR.status === "fulfilled" ? approvedR.value : [];
      const pending = pendingR.status === "fulfilled" ? pendingR.value : [];
      setSlots([...approved, ...pending]);
    });
  }, [classArmId, academicSessionId, termId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  useEffect(() => {
    if (!canManage) return;
    apiFetch<SubjectOption[]>("/subjects", { auth: true }).then(setSubjects).catch(() => setSubjects([]));
    apiFetch<StaffOption[]>("/staff-profiles", { auth: true }).then(setStaffOptions).catch(() => setStaffOptions([]));
  }, [canManage]);

  // CLAUDE.md: GET /subjects returns isGroup subjects with children nested,
  // not flattened — only a childSubject is ever actually assignable/
  // scoreable (PRD §3.3), so a slot's own subjectId is always a child's id
  // when its subject belongs to a group. Same flatMap pattern as
  // staff-assignment-form.tsx/gradebook/page.tsx.
  const selectableSubjects = useMemo(
    () =>
      subjects.flatMap((s) =>
        s.isGroup && s.childSubjects && s.childSubjects.length > 0
          ? s.childSubjects.map((child) => ({ id: child.id, name: `${child.name} (${s.name})` }))
          : [{ id: s.id, name: s.name }],
      ),
    [subjects],
  );

  const periodRows = useMemo(() => {
    if (!slots) return [];
    return [...new Set(slots.map((s) => s.startTime))].sort();
  }, [slots]);

  // Merges in whichever staff members are already visible in the loaded
  // slots — same fallback pattern as invigilation-grid.tsx/duty-grid.tsx.
  // GET /staff-profiles is a separate CASL "read StaffProfile" grant from
  // "manage TimetableSlot", so a viewer who can edit slots but hits a 403
  // fetching the full staff list (or one that's just slow/hasn't loaded
  // yet) still sees at least the teachers already assigned in this grid,
  // not an empty Select.
  const staffSelectOptions = useMemo(() => {
    const byId = new Map(staffOptions.map((s) => [s.id, s]));
    for (const slot of slots ?? []) {
      if (!byId.has(slot.staffId)) byId.set(slot.staffId, { id: slot.staffId, user: slot.staff.user });
    }
    return [...byId.values()];
  }, [staffOptions, slots]);

  async function patchSlot(id: string, data: Record<string, unknown>) {
    return apiFetch(`/timetable-slots/${id}`, { method: "PATCH", auth: true, body: data });
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || !slots) return;
    const [day, startTime] = String(over.id).split("|") as [DayOfWeek, string];
    const slot = slots.find((s) => s.id === String(active.id));
    if (!slot || (slot.dayOfWeek === day && slot.startTime === startTime)) return;

    const durationMinutes = timeToMinutes(slot.endTime) - timeToMinutes(slot.startTime);
    const newEndTime = minutesToTime(timeToMinutes(startTime) + durationMinutes);
    setActionError(null);
    try {
      await patchSlot(slot.id, { dayOfWeek: day, startTime, endTime: newEndTime });
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Failed to move slot — the target may already be booked");
    }
  }

  async function saveField(slot: TimetableSlotItem, field: string, value: string) {
    setFieldStatus((s) => ({ ...s, [slot.id]: "saving" }));
    try {
      await patchSlot(slot.id, { [field]: value });
      setFieldStatus((s) => ({ ...s, [slot.id]: "saved" }));
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Failed to save change");
      setFieldStatus((s) => ({ ...s, [slot.id]: "error" }));
    }
  }

  if (!classArmId || !academicSessionId || !termId) {
    return <p className="text-sm text-muted">Select a class, session, and term to view its timetable.</p>;
  }
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!slots) return <p className="text-sm text-muted">Loading…</p>;
  if (periodRows.length === 0) {
    return (
      <p className="text-sm text-muted">
        {canManage ? "No slots yet — add one below to start building this arm's timetable." : "No timetable published yet."}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {actionError && <p className="text-[12.5px] text-danger">{actionError}</p>}
      <DndContext onDragEnd={handleDragEnd}>
        <div className="overflow-auto">
          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: `70px repeat(${DAYS.length}, minmax(160px, 1fr))` }}
          >
            <div />
            {DAYS.map((day) => (
              <div key={day} className="text-[10px] font-medium uppercase tracking-wide text-muted">
                {DAY_LABELS[day]}
              </div>
            ))}
            {periodRows.map((startTime) => (
              <div key={startTime} className="contents">
                <div className="pt-1.5 font-mono text-[10.5px] text-muted">{startTime}</div>
                {DAYS.map((day) => {
                  const slot = slots.find((s) => s.dayOfWeek === day && s.startTime === startTime);
                  return (
                    <DroppableCell key={cellKey(day, startTime)} day={day} startTime={startTime}>
                      {slot && (
                        <SlotCard
                          slot={slot}
                          canManage={canManage}
                          subjects={selectableSubjects}
                          staffOptions={staffSelectOptions}
                          fieldStatus={fieldStatus[slot.id]}
                          onFieldChange={(field, value) => saveField(slot, field, value)}
                        />
                      )}
                    </DroppableCell>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </DndContext>
    </div>
  );
}

function SlotCard({
  slot,
  canManage,
  subjects,
  staffOptions,
  fieldStatus,
  onFieldChange,
}: {
  slot: TimetableSlotItem;
  canManage: boolean;
  subjects: { id: string; name: string }[];
  staffOptions: StaffOption[];
  fieldStatus?: "saving" | "saved" | "error";
  onFieldChange: (field: string, value: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: slot.id });
  const pending = slot.approvalStatus === "PENDING_REVIEW";

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
            aria-label="Drag to move"
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
          <Select value={slot.subjectId} onValueChange={(v) => onFieldChange("subjectId", v)}>
            <SelectTrigger className="h-auto min-h-7 items-start px-1.5 py-1.5 text-left text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {subjects.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={slot.staffId} onValueChange={(v) => onFieldChange("staffId", v)}>
            <SelectTrigger className="h-7 px-1.5 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {staffOptions.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.user.firstName} {s.user.lastName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fieldStatus === "saving" && <span className="text-[10px] text-muted">Saving…</span>}
          {fieldStatus === "error" && <span className="text-[10px] text-danger">Failed to save</span>}
        </div>
      ) : (
        <>
          <div className="font-medium">{slot.subject.name}</div>
          <div className="text-muted">
            {slot.staff.user.firstName} {slot.staff.user.lastName}
          </div>
        </>
      )}

    </div>
  );
}
