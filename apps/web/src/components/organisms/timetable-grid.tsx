"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DndContext, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import { categoryToGroup, computePeriodTime, DAYS_OF_WEEK, type ClassLevelCategoryGroup, type DayOfWeek } from "@school/types";
import { apiFetch, ApiError } from "../../lib/api";
import { buildPeriodColumns, findSpecialPeriod, fridayCutoffColumnIndex, resolvePeriodIndex } from "../../lib/period-columns";
import { usePeriodStructure, useSpecialPeriods } from "../../lib/use-period-structure";
import { Badge } from "../atoms/badge";
import { ClickReveal } from "../molecules/click-reveal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";
import { cn } from "../../lib/cn";

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
interface ClassArmDetail {
  id: string;
  classLevel: { category: "CRECHE" | "NURSERY" | "PRIMARY" | "JSS" | "SSS" };
}

const DAY_LABELS: Record<DayOfWeek, string> = {
  MONDAY: "Mon",
  TUESDAY: "Tue",
  WEDNESDAY: "Wed",
  THURSDAY: "Thu",
  FRIDAY: "Fri",
};

function cellKey(day: string, periodIndex: number) {
  return `${day}|${periodIndex}`;
}

function DroppableCell({ day, periodIndex, children }: { day: DayOfWeek; periodIndex: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: cellKey(day, periodIndex) });
  return (
    <div
      ref={setNodeRef}
      className={cn("min-h-[52px] rounded-lg border border-dashed border-transparent p-0.5", isOver && "border-primary bg-primary/5")}
    >
      {children}
    </div>
  );
}

/**
 * BUILD_PLAN.md §9 Step 6b: a Day(row) x Period(column) grid — matches the
 * hand-drawn timetable grid this UI is modeled on (DAY/Class rows, one
 * column per period plus a BREAK column). Columns come from the class arm's
 * group `PeriodStructure` (`usePeriodStructure`/`buildPeriodColumns`) rather
 * than being derived from whichever slots happen to be loaded — so empty
 * periods still show up as drop targets, not just occupied ones. A cell
 * shows just the subject; the teacher's name/edit control is revealed only
 * on click (read-only: `ClickReveal`; editable: an inline expand — nesting
 * a `Select` inside a portal-based popover is fragile with Radix, so
 * editing expands the cell itself instead of popping over it).
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
  const [classArm, setClassArm] = useState<ClassArmDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [fieldStatus, setFieldStatus] = useState<Record<string, "saving" | "saved" | "error">>({});
  const [expandedSlotId, setExpandedSlotId] = useState<string | null>(null);

  const group: ClassLevelCategoryGroup | null = classArm ? categoryToGroup(classArm.classLevel.category) : null;
  const structure = usePeriodStructure(group);
  const { specialPeriods, fridayTrailingActivity } = useSpecialPeriods(group);
  const columns = useMemo(() => (structure ? buildPeriodColumns(structure) : []), [structure]);
  const fridayCutoff = useMemo(
    () => (structure ? fridayCutoffColumnIndex(structure, columns) : -1),
    [structure, columns],
  );

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
    if (!classArmId) {
      setClassArm(null);
      return;
    }
    apiFetch<ClassArmDetail>(`/class-arms/${classArmId}`, { auth: true }).then(setClassArm).catch(() => setClassArm(null));
  }, [classArmId]);

  useEffect(() => {
    if (!canManage) return;
    apiFetch<SubjectOption[]>("/subjects", { auth: true }).then(setSubjects).catch(() => setSubjects([]));
    apiFetch<StaffOption[]>("/staff-profiles", { auth: true }).then(setStaffOptions).catch(() => setStaffOptions([]));
  }, [canManage]);

  // Collapse any open editor whenever the arm/session/term changes underneath it.
  useEffect(() => {
    setExpandedSlotId(null);
  }, [classArmId, academicSessionId, termId]);

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

  // O(1) cell lookup, resolved against each slot's *own* dayOfWeek (Friday's
  // shorter break shifts which period a startTime falls in).
  const slotByCell = useMemo(() => {
    const map = new Map<string, TimetableSlotItem>();
    if (!slots || !structure) return map;
    for (const slot of slots) {
      const periodIndex = resolvePeriodIndex(structure, slot.dayOfWeek, slot.startTime);
      if (periodIndex !== null) map.set(cellKey(slot.dayOfWeek, periodIndex), slot);
    }
    return map;
  }, [slots, structure]);

  async function patchSlot(id: string, data: Record<string, unknown>) {
    return apiFetch(`/timetable-slots/${id}`, { method: "PATCH", auth: true, body: data });
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || !slots || !structure) return;
    const [day, periodIndexStr] = String(over.id).split("|") as [DayOfWeek, string];
    const { startTime, endTime } = computePeriodTime(structure, day, Number(periodIndexStr));
    const slot = slots.find((s) => s.id === String(active.id));
    if (!slot || (slot.dayOfWeek === day && slot.startTime === startTime)) return;

    setActionError(null);
    try {
      await patchSlot(slot.id, { dayOfWeek: day, startTime, endTime });
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
  if (!slots || !classArm) return <p className="text-sm text-muted">Loading…</p>;
  if (!structure) {
    return (
      <p className="text-sm text-muted">
        This class's group period structure isn't fully configured yet — set it under Constraints (PERIODS_PER_DAY,
        PERIOD_DURATION_MINUTES, SCHOOL_DAY_START_TIME, BREAK_AFTER_PERIOD, BREAK_DURATION_MINUTES, FRIDAY_BREAK_DURATION_MINUTES).
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {actionError && <p className="text-[12.5px] text-danger">{actionError}</p>}
      <DndContext onDragEnd={handleDragEnd}>
        <div className="overflow-auto">
          <div className="grid gap-1.5" style={{ gridTemplateColumns: `50px repeat(${columns.length}, minmax(110px, 1fr))` }}>
            <div />
            {columns.map((col, i) => (
              <div key={i} className="text-center font-mono text-[9.5px] font-medium text-muted">
                {col.kind === "break" ? "Break" : `${col.startTime}–${col.endTime}`}
              </div>
            ))}
            {DAYS_OF_WEEK.map((day) => {
              // Friday may end before the shared column set does — everything
              // past its real last period collapses into one spanning cell
              // (the trailing-activity label, if configured) instead of
              // rendering columns Friday never uses.
              const lastIndex = day === "FRIDAY" ? fridayCutoff : columns.length - 1;
              return (
                <div key={day} className="contents">
                  <div className="pt-1.5 text-[10px] font-medium uppercase tracking-wide text-muted">{DAY_LABELS[day]}</div>
                  {columns.slice(0, lastIndex + 1).map((col, i) => {
                    if (col.kind === "break") {
                      return <div key={i} className="min-h-[52px] rounded-lg bg-muted/10" />;
                    }
                    const special = findSpecialPeriod(specialPeriods, day, col.index);
                    if (special) {
                      return (
                        <div
                          key={i}
                          className="flex min-h-[52px] items-center justify-center rounded-lg bg-info-bg px-1 text-center text-[10px] font-medium text-info"
                        >
                          {special.label}
                        </div>
                      );
                    }
                    const slot = slotByCell.get(cellKey(day, col.index));
                    return (
                      <DroppableCell key={i} day={day} periodIndex={col.index}>
                        {slot && (
                          <SlotCard
                            slot={slot}
                            canManage={canManage}
                            expanded={expandedSlotId === slot.id}
                            onToggleExpand={() => setExpandedSlotId((cur) => (cur === slot.id ? null : slot.id))}
                            subjects={selectableSubjects}
                            staffOptions={staffSelectOptions}
                            fieldStatus={fieldStatus[slot.id]}
                            onFieldChange={(field, value) => saveField(slot, field, value)}
                          />
                        )}
                      </DroppableCell>
                    );
                  })}
                  {day === "FRIDAY" && fridayCutoff < columns.length - 1 && (
                    <div
                      className="flex min-h-[52px] items-center justify-center rounded-lg bg-muted/10 px-1 text-center text-[10px] font-medium text-muted"
                      style={{ gridColumn: `span ${columns.length - 1 - fridayCutoff}` }}
                    >
                      {fridayTrailingActivity ? `${fridayTrailingActivity.label} · until ${fridayTrailingActivity.endTime}` : "—"}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </DndContext>
    </div>
  );
}

function SlotCard({
  slot,
  canManage,
  expanded,
  onToggleExpand,
  subjects,
  staffOptions,
  fieldStatus,
  onFieldChange,
}: {
  slot: TimetableSlotItem;
  canManage: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  subjects: { id: string; name: string }[];
  staffOptions: StaffOption[];
  fieldStatus?: "saving" | "saved" | "error";
  onFieldChange: (field: string, value: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: slot.id });
  const pending = slot.approvalStatus === "PENDING_REVIEW";
  const editorRef = useRef<HTMLDivElement>(null);

  // Closes the floating editor on a click anywhere outside it — except
  // inside a Select's own portaled dropdown (rendered outside this panel's
  // DOM subtree, so a plain `.contains()` check would otherwise treat
  // picking a subject/staff option as an "outside" click and close the
  // panel out from under the selection). Radix Select content carries
  // role="listbox".
  useEffect(() => {
    if (!expanded) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (editorRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[role="listbox"]')) return;
      onToggleExpand();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [expanded, onToggleExpand]);

  return (
    <div
      ref={setNodeRef}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 10 } : undefined}
      className={cn(
        "relative rounded-lg border bg-card-inset p-1.5 text-[11.5px]",
        pending ? "border-dashed border-warning" : "border-border",
        isDragging && "opacity-60 shadow-md",
      )}
    >
      <div className="mb-0.5 flex items-center justify-between gap-1">
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
        <div className="relative" ref={editorRef}>
          <button type="button" onClick={onToggleExpand} className="block w-full truncate text-left font-medium">
            {slot.subject.code || slot.subject.name}
          </button>
          {expanded && (
            // Floats above the grid at a fixed, comfortable width rather
            // than squeezing two dropdowns into a ~110px column — that's
            // what made this unusable before (the Select's own open list
            // rendered fine, but the trigger/Done link were crushed
            // alongside it in the narrow cell).
            <div className="absolute left-0 top-full z-20 mt-1 w-56 space-y-1.5 rounded-lg border border-border bg-card p-2 shadow-lg">
              <Select value={slot.subjectId} onValueChange={(v) => onFieldChange("subjectId", v)}>
                <SelectTrigger className="h-auto min-h-8 items-start px-2 py-1.5 text-left text-[12px]">
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
                <SelectTrigger className="h-8 px-2 text-[12px]">
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
              <div className="flex items-center justify-between">
                {fieldStatus === "saving" && <span className="text-[10px] text-muted">Saving…</span>}
                {fieldStatus === "error" && <span className="text-[10px] text-danger">Failed to save</span>}
                <button type="button" onClick={onToggleExpand} className="ml-auto text-[11px] text-primary underline">
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <ClickReveal trigger={<span className="truncate font-medium">{slot.subject.code || slot.subject.name}</span>}>
          <div className="font-medium">{slot.subject.name}</div>
          <div className="text-muted">
            {slot.staff.user.firstName} {slot.staff.user.lastName}
          </div>
          {slot.venue && <div className="text-muted">{slot.venue}</div>}
        </ClickReveal>
      )}
    </div>
  );
}
