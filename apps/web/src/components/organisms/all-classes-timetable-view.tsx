"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DAYS_OF_WEEK, type DayOfWeek } from "@school/types";
import { apiFetch, ApiError } from "../../lib/api";
import { Badge } from "../atoms/badge";
import { Button } from "../atoms/button";

interface TimetableSlotItem {
  id: string;
  classArmId: string;
  classArm: { displayName: string };
  subject: { name: string };
  staff: { user: { firstName: string; lastName: string } };
  dayOfWeek: DayOfWeek;
  startTime: string;
  endTime: string;
  venue: string | null;
  approvalStatus: "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "REJECTED";
}

const DAY_LABELS: Record<DayOfWeek, string> = {
  MONDAY: "Monday",
  TUESDAY: "Tuesday",
  WEDNESDAY: "Wednesday",
  THURSDAY: "Thursday",
  FRIDAY: "Friday",
};

/**
 * BUILD_PLAN.md §9 Step 7's "whole-school timetable overview" (PRD FR6.10,
 * §5 footnote 6) — scoped by the caller's academic session/term only (no
 * classArmId), which TimetableSlotService.findAll now supports directly,
 * including its own server-side Principal→JSS/SSS / Headteacher→Creche/
 * Nursery/Primary scoping. Read-only: this view is for oversight across
 * every class at once — editing stays in the single-class TimetableGrid
 * (drag-and-drop), reached here via "Edit this class".
 */
export function AllClassesTimetableView({
  academicSessionId,
  termId,
  onViewClass,
}: {
  academicSessionId: string;
  termId: string;
  onViewClass: (classArmId: string) => void;
}) {
  const [rows, setRows] = useState<TimetableSlotItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<"day" | "class">("day");

  const load = useCallback(() => {
    if (!academicSessionId || !termId) {
      setRows(null);
      return;
    }
    const qs = `academicSessionId=${academicSessionId}&termId=${termId}`;
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
      setRows([...approved, ...pending]);
    });
  }, [academicSessionId, termId]);

  useEffect(() => {
    load();
  }, [load]);

  const byDay = useMemo(() => {
    if (!rows) return [];
    return DAYS_OF_WEEK.map((day) => ({
      day,
      items: rows
        .filter((r) => r.dayOfWeek === day)
        .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.classArm.displayName.localeCompare(b.classArm.displayName)),
    })).filter((g) => g.items.length > 0);
  }, [rows]);

  const byClass = useMemo(() => {
    if (!rows) return [];
    const byId = new Map<string, { classArmId: string; displayName: string; items: TimetableSlotItem[] }>();
    for (const row of rows) {
      const entry = byId.get(row.classArmId) ?? { classArmId: row.classArmId, displayName: row.classArm.displayName, items: [] };
      entry.items.push(row);
      byId.set(row.classArmId, entry);
    }
    for (const entry of byId.values()) {
      entry.items.sort((a, b) => DAYS_OF_WEEK.indexOf(a.dayOfWeek) - DAYS_OF_WEEK.indexOf(b.dayOfWeek) || a.startTime.localeCompare(b.startTime));
    }
    return [...byId.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [rows]);

  if (!academicSessionId || !termId) {
    return <p className="text-sm text-muted">Select a session and term to view the whole-school timetable.</p>;
  }
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!rows) return <p className="text-sm text-muted">Loading…</p>;
  if (rows.length === 0) return <p className="text-sm text-muted">No timetable published yet for this term.</p>;

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        <Button type="button" size="sm" variant={groupBy === "day" ? "primary" : "outline"} onClick={() => setGroupBy("day")}>
          By day
        </Button>
        <Button type="button" size="sm" variant={groupBy === "class" ? "primary" : "outline"} onClick={() => setGroupBy("class")}>
          By class
        </Button>
      </div>

      {groupBy === "day"
        ? byDay.map(({ day, items }) => (
            <div key={day}>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">{DAY_LABELS[day]}</div>
              <ScheduleTable
                headers={["Time", "Class", "Subject", "Teacher", "Venue"]}
                rows={items.map((i) => ({
                  id: i.id,
                  pending: i.approvalStatus === "PENDING_REVIEW",
                  cells: [
                    `${i.startTime}–${i.endTime}`,
                    i.classArm.displayName,
                    i.subject.name,
                    `${i.staff.user.firstName} ${i.staff.user.lastName}`,
                    i.venue ?? "—",
                  ],
                  onClick: () => onViewClass(i.classArmId),
                }))}
              />
            </div>
          ))
        : byClass.map(({ classArmId, displayName, items }) => (
            <div key={classArmId}>
              <div className="mb-1 flex items-center gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted">{displayName}</span>
                <button type="button" onClick={() => onViewClass(classArmId)} className="text-[11px] text-primary underline">
                  Edit this class
                </button>
              </div>
              <ScheduleTable
                headers={["Day", "Time", "Subject", "Teacher", "Venue"]}
                rows={items.map((i) => ({
                  id: i.id,
                  pending: i.approvalStatus === "PENDING_REVIEW",
                  cells: [DAY_LABELS[i.dayOfWeek], `${i.startTime}–${i.endTime}`, i.subject.name, `${i.staff.user.firstName} ${i.staff.user.lastName}`, i.venue ?? "—"],
                }))}
              />
            </div>
          ))}
    </div>
  );
}

function ScheduleTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: { id: string; pending: boolean; cells: string[]; onClick?: () => void }[];
}) {
  return (
    <div className="mb-3 overflow-x-auto">
      <table className="w-full text-left text-[12.5px]">
        <thead>
          <tr className="border-b border-border text-[10.5px] uppercase tracking-wide text-muted">
            {headers.map((h) => (
              <th key={h} className="py-1.5 pr-3 font-medium">
                {h}
              </th>
            ))}
            <th className="py-1.5 pr-0" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-border">
              {row.cells.map((cell, i) => (
                <td key={i} className="py-1.5 pr-3">
                  {cell}
                </td>
              ))}
              <td className="py-1.5 pr-0 text-right">
                <div className="flex items-center justify-end gap-2">
                  {row.pending && (
                    <Badge variant="warning" className="text-[9px]">
                      Pending
                    </Badge>
                  )}
                  {row.onClick && (
                    <button type="button" onClick={row.onClick} className="text-[11px] text-primary underline">
                      Edit class
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
