"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Badge } from "../atoms/badge";
import { ClickReveal } from "../molecules/click-reveal";

interface ExamScheduleItem {
  id: string;
  classArmId: string;
  classArm: { displayName: string };
  subject: { id: string; name: string; code: string };
  date: string;
  startTime: string;
  endTime: string;
  venue: string | null;
  approvalStatus: "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "REJECTED";
}

function isoDate(date: string) {
  return date.slice(0, 10);
}

/**
 * The exam-timetable half of BUILD_PLAN.md §9 Step 7's whole-school overview
 * — a Date+Class-by-time-slot grid (columns derived from the loaded rows'
 * distinct startTimes, same approach as the single-class ExamTimetableGrid,
 * since exam slot durations vary by calc/non-calc subject rather than
 * following a fixed period structure). Read-only — editing stays in the
 * single-class ExamTimetableGrid, reached here via each row's "Edit" link.
 */
export function AllClassesExamTimetableView({
  assessmentComponentId,
  onViewClass,
}: {
  assessmentComponentId: string;
  onViewClass: (classArmId: string) => void;
}) {
  const [rows, setRows] = useState<ExamScheduleItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!assessmentComponentId) {
      setRows(null);
      return;
    }
    const qs = `assessmentComponentId=${assessmentComponentId}`;
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
  }, [assessmentComponentId]);

  useEffect(() => {
    load();
  }, [load]);

  const dateKeys = useMemo(() => {
    if (!rows) return [];
    return [...new Set(rows.map((r) => isoDate(r.date)))].sort();
  }, [rows]);
  const timeColumns = useMemo(() => {
    if (!rows) return [];
    return [...new Set(rows.map((r) => r.startTime))].sort();
  }, [rows]);
  const classArmsByDate = useMemo(() => {
    const map = new Map<string, { classArmId: string; displayName: string }[]>();
    if (!rows) return map;
    for (const date of dateKeys) {
      const seen = new Map<string, string>();
      for (const row of rows) {
        if (isoDate(row.date) === date) seen.set(row.classArmId, row.classArm.displayName);
      }
      map.set(
        date,
        [...seen.entries()].map(([classArmId, displayName]) => ({ classArmId, displayName })).sort((a, b) => a.displayName.localeCompare(b.displayName)),
      );
    }
    return map;
  }, [rows, dateKeys]);
  const rowByCell = useMemo(() => {
    const map = new Map<string, ExamScheduleItem>();
    for (const row of rows ?? []) map.set(`${row.classArmId}|${isoDate(row.date)}|${row.startTime}`, row);
    return map;
  }, [rows]);

  if (!assessmentComponentId) {
    return <p className="text-sm text-muted">Select an assessment component to view every class's exam timetable.</p>;
  }
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!rows) return <p className="text-sm text-muted">Loading…</p>;
  if (rows.length === 0) return <p className="text-sm text-muted">No exam timetable published yet for this component.</p>;

  return (
    <div className="space-y-4">
      {dateKeys.map((date) => {
        const arms = classArmsByDate.get(date) ?? [];
        return (
          <div key={date}>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
              {new Date(date).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <div className="grid" style={{ gridTemplateColumns: `160px repeat(${timeColumns.length}, minmax(110px, 1fr))` }}>
                <div className="border-b border-border bg-card-inset px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                  Class
                </div>
                {timeColumns.map((t) => (
                  <div
                    key={t}
                    className="border-b border-border bg-card-inset px-1.5 py-1.5 text-center font-mono text-[9.5px] font-medium text-muted"
                  >
                    {t}
                  </div>
                ))}

                {arms.map((arm) => (
                  <div key={arm.classArmId} className="contents">
                    <div className="flex items-center justify-between gap-1.5 border-b border-border px-2 py-2 text-[12px]">
                      <span className="truncate">{arm.displayName}</span>
                      <button
                        type="button"
                        onClick={() => onViewClass(arm.classArmId)}
                        className="flex-none text-[10.5px] text-primary underline"
                      >
                        Edit
                      </button>
                    </div>
                    {timeColumns.map((t) => {
                      const row = rowByCell.get(`${arm.classArmId}|${date}|${t}`);
                      return (
                        <div key={t} className="border-b border-border px-1 py-1.5">
                          {row && (
                            <ClickReveal
                              className={
                                row.approvalStatus === "PENDING_REVIEW"
                                  ? "rounded border border-dashed border-warning px-1 py-0.5"
                                  : undefined
                              }
                              trigger={<span className="truncate text-[11px] font-medium">{row.subject.code || row.subject.name}</span>}
                            >
                              <div className="font-medium">{row.subject.name}</div>
                              <div className="font-mono text-muted">
                                {row.startTime}–{row.endTime}
                              </div>
                              {row.venue && <div className="text-muted">{row.venue}</div>}
                              {row.approvalStatus === "PENDING_REVIEW" && (
                                <Badge variant="warning" className="mt-1 text-[9px]">
                                  Pending
                                </Badge>
                              )}
                            </ClickReveal>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
