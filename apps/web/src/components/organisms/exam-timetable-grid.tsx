"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DndContext, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import { timeToMinutes } from "@school/types";
import { apiFetch, ApiError } from "../../lib/api";
import { buildExamColumns, formatExamDate, minutesToTime } from "../../lib/exam-columns";
import { Badge } from "../atoms/badge";
import { Input } from "../atoms/input";
import { ClickReveal } from "../molecules/click-reveal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";
import { cn } from "../../lib/cn";

type ApprovalStatus = "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "REJECTED";

interface ExamScheduleItem {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  venue: string | null;
  approvalStatus: ApprovalStatus;
  subjectId: string;
  subject: { name: string; code?: string | null };
}
interface SubjectOption {
  id: string;
  name: string;
  code: string;
  isGroup: boolean;
  childSubjects?: { id: string; name: string; code: string }[];
}

function isoDate(date: string) {
  return date.slice(0, 10);
}

function cellKey(date: string, startTime: string) {
  return `${date}|${startTime}`;
}

function DroppableCell({ dateKey, startTime, children }: { dateKey: string; startTime: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: cellKey(dateKey, startTime) });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-h-[52px] space-y-1 rounded-lg border border-dashed border-transparent p-0.5",
        isOver && "border-primary bg-primary/5",
      )}
    >
      {children}
    </div>
  );
}

/**
 * BUILD_PLAN.md §9 Step 6d: extends Step 6b's drag-and-drop grid pattern to
 * exam timetables, laid out like timetable-grid.tsx — a Date(row) x
 * Slot(column) grid with a time-range header per column and a BREAK column
 * (`buildExamColumns`, derived from the loaded rows since exam days have no
 * PeriodStructure). A cell can hold several papers at once (elective
 * alternatives sat in the same slot, e.g. SSS Literature/Accounting/
 * Physics), so every row in the cell is rendered, not just the first. No
 * staff field — ExamSchedule has none (PRD §3.8, invigilation is a separate
 * staff pool). No swap semantics on drop — a conflict just reverts with an
 * error, identical mechanics to timetable-grid.tsx.
 */
export function ExamTimetableGrid({
  classArmId,
  assessmentComponentId,
  canManage,
  refreshKey,
}: {
  classArmId: string;
  assessmentComponentId: string;
  canManage: boolean;
  refreshKey?: unknown;
}) {
  const [rows, setRows] = useState<ExamScheduleItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [fieldStatus, setFieldStatus] = useState<Record<string, "saving" | "saved" | "error">>({});
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!classArmId || !assessmentComponentId) {
      setRows(null);
      return;
    }
    const qs = `classArmId=${classArmId}&assessmentComponentId=${assessmentComponentId}`;
    Promise.allSettled([
      apiFetch<ExamScheduleItem[]>(`/exam-schedules?${qs}`, { auth: true }),
      apiFetch<ExamScheduleItem[]>(`/exam-schedules?${qs}&approvalStatus=PENDING_REVIEW`, { auth: true }),
    ]).then(([approvedR, pendingR]) => {
      if (approvedR.status === "rejected" && pendingR.status === "rejected") {
        setError(approvedR.reason instanceof ApiError ? approvedR.reason.message : "Failed to load exam timetable");
        return;
      }
      setError(null);
      const approved = approvedR.status === "fulfilled" ? approvedR.value : [];
      const pending = pendingR.status === "fulfilled" ? pendingR.value : [];
      setRows([...approved, ...pending]);
    });
  }, [classArmId, assessmentComponentId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  useEffect(() => {
    if (!canManage) return;
    apiFetch<SubjectOption[]>("/subjects", { auth: true }).then(setSubjects).catch(() => setSubjects([]));
  }, [canManage]);

  useEffect(() => {
    setExpandedRowId(null);
  }, [classArmId, assessmentComponentId]);

  // CLAUDE.md: GET /subjects returns isGroup subjects with children nested,
  // not flattened — same flatMap pattern as timetable-grid.tsx.
  const selectableSubjects = useMemo(
    () =>
      subjects.flatMap((s) =>
        s.isGroup && s.childSubjects && s.childSubjects.length > 0
          ? s.childSubjects.map((child) => ({ id: child.id, name: `${child.name} (${s.name})` }))
          : [{ id: s.id, name: s.name }],
      ),
    [subjects],
  );

  const dateRows = useMemo(() => {
    if (!rows) return [];
    return [...new Set(rows.map((r) => isoDate(r.date)))].sort();
  }, [rows]);
  const columns = useMemo(() => buildExamColumns(rows ?? []), [rows]);
  const rowsByCell = useMemo(() => {
    const map = new Map<string, ExamScheduleItem[]>();
    for (const row of rows ?? []) {
      const key = cellKey(isoDate(row.date), row.startTime);
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return map;
  }, [rows]);

  async function patchRow(id: string, data: Record<string, unknown>) {
    return apiFetch(`/exam-schedules/${id}`, { method: "PATCH", auth: true, body: data });
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || !rows) return;
    const [date, startTime] = String(over.id).split("|") as [string, string];
    const row = rows.find((r) => r.id === String(active.id));
    if (!row || (isoDate(row.date) === date && row.startTime === startTime)) return;

    const durationMinutes = timeToMinutes(row.endTime) - timeToMinutes(row.startTime);
    const newEndTime = minutesToTime(timeToMinutes(startTime) + durationMinutes);
    setActionError(null);
    try {
      await patchRow(row.id, { date, startTime, endTime: newEndTime });
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Failed to move exam — the target may already be booked");
    }
  }

  async function saveField(row: ExamScheduleItem, field: string, value: string) {
    setFieldStatus((s) => ({ ...s, [row.id]: "saving" }));
    try {
      await patchRow(row.id, { [field]: value });
      setFieldStatus((s) => ({ ...s, [row.id]: "saved" }));
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Failed to save change");
      setFieldStatus((s) => ({ ...s, [row.id]: "error" }));
    }
  }

  if (!classArmId || !assessmentComponentId) {
    return <p className="text-sm text-muted">Select an assessment component and class arm to view its exam timetable.</p>;
  }
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!rows) return <p className="text-sm text-muted">Loading…</p>;
  if (dateRows.length === 0) {
    return <p className="text-sm text-muted">{canManage ? "No exam schedule yet for this arm/component." : "No exam schedule published yet."}</p>;
  }

  return (
    <div className="space-y-2">
      {actionError && <p className="text-[12.5px] text-danger">{actionError}</p>}
      <DndContext onDragEnd={handleDragEnd}>
        <div className="overflow-auto">
          <div className="grid gap-1.5" style={{ gridTemplateColumns: `80px repeat(${columns.length}, minmax(110px, 1fr))` }}>
            <div />
            {columns.map((col, i) => (
              <div key={i} className="text-center font-mono text-[9.5px] font-medium text-muted">
                {col.kind === "break" ? (
                  <>
                    Break
                    <br />
                    {col.startTime}–{col.endTime}
                  </>
                ) : (
                  `${col.startTime}–${col.endTime}`
                )}
              </div>
            ))}
            {dateRows.map((date) => (
              <div key={date} className="contents">
                <div className="pt-1.5 text-[10px] font-medium uppercase tracking-wide text-muted">{formatExamDate(date)}</div>
                {columns.map((col, i) => {
                  if (col.kind === "break") {
                    return (
                      <div
                        key={i}
                        className="flex min-h-[52px] items-center justify-center rounded-lg bg-muted/10 text-[10px] font-medium uppercase tracking-wide text-muted"
                      >
                        Break
                      </div>
                    );
                  }
                  const cellRows = rowsByCell.get(cellKey(date, col.startTime)) ?? [];
                  return (
                    <DroppableCell key={i} dateKey={date} startTime={col.startTime}>
                      {cellRows.map((row) => (
                        <ExamCard
                          key={row.id}
                          row={row}
                          canManage={canManage}
                          expanded={expandedRowId === row.id}
                          onToggleExpand={() => setExpandedRowId((cur) => (cur === row.id ? null : row.id))}
                          subjects={selectableSubjects}
                          fieldStatus={fieldStatus[row.id]}
                          onFieldChange={(field, value) => saveField(row, field, value)}
                        />
                      ))}
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

function ExamCard({
  row,
  canManage,
  expanded,
  onToggleExpand,
  subjects,
  fieldStatus,
  onFieldChange,
}: {
  row: ExamScheduleItem;
  canManage: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  subjects: { id: string; name: string }[];
  fieldStatus?: "saving" | "saved" | "error";
  onFieldChange: (field: string, value: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: row.id });
  const pending = row.approvalStatus === "PENDING_REVIEW";
  const editorRef = useRef<HTMLDivElement>(null);
  const label = row.subject.code || row.subject.name;
  // A group sat as one paper ({EXAM,MID_TERM}_COLLAPSE_GROUP_SUBJECTS, e.g.
  // Basic's "English Language") isn't in the flattened options — keep it
  // selectable on its own row so the Select doesn't render blank.
  const options = subjects.some((s) => s.id === row.subjectId)
    ? subjects
    : [{ id: row.subjectId, name: row.subject.name }, ...subjects];

  // Same outside-click close as timetable-grid.tsx's SlotCard, ignoring
  // clicks inside the Select's portaled listbox.
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
          <button type="button" onClick={onToggleExpand} className="block w-full truncate text-left font-medium" title={row.subject.name}>
            {label}
          </button>
          {expanded && (
            <div className="absolute left-0 top-full z-20 mt-1 w-56 space-y-1.5 rounded-lg border border-border bg-card p-2 shadow-lg">
              <div className="font-mono text-[10.5px] text-muted">
                {row.startTime}–{row.endTime}
              </div>
              <Select value={row.subjectId} onValueChange={(v) => onFieldChange("subjectId", v)}>
                <SelectTrigger className="h-auto min-h-8 items-start px-2 py-1.5 text-left text-[12px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                defaultValue={row.venue ?? ""}
                placeholder="Venue"
                className="h-8 px-2 text-[12px]"
                onBlur={(e) => e.target.value !== (row.venue ?? "") && onFieldChange("venue", e.target.value)}
              />
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
        <ClickReveal trigger={<span className="truncate font-medium">{label}</span>}>
          <div className="font-medium">{row.subject.name}</div>
          <div className="font-mono text-muted">
            {row.startTime}–{row.endTime}
          </div>
          {row.venue && <div className="text-muted">{row.venue}</div>}
        </ClickReveal>
      )}
    </div>
  );
}
