"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Badge } from "../atoms/badge";

interface ExamScheduleItem {
  id: string;
  classArmId: string;
  classArm: { displayName: string };
  subject: { name: string };
  date: string;
  startTime: string;
  endTime: string;
  venue: string | null;
  approvalStatus: "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "REJECTED";
}

/**
 * The exam-timetable half of BUILD_PLAN.md §9 Step 7's whole-school overview
 * — every class arm sitting the selected assessment component, in one flat
 * table (date/time-sorted), rather than one class arm at a time. Reuses
 * ExamScheduleService.findAll with no classArmId, which already supports
 * this (and applies the same server-side Principal/Headteacher category-
 * group scoping). Read-only — editing stays in the single-class
 * ExamTimetableGrid, reached here via "Edit this class".
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
      setRows(
        [...approved, ...pending].sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.startTime.localeCompare(b.startTime),
        ),
      );
    });
  }, [assessmentComponentId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!assessmentComponentId) {
    return <p className="text-sm text-muted">Select an assessment component to view every class's exam timetable.</p>;
  }
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!rows) return <p className="text-sm text-muted">Loading…</p>;
  if (rows.length === 0) return <p className="text-sm text-muted">No exam timetable published yet for this component.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[12.5px]">
        <thead>
          <tr className="border-b border-border text-[10.5px] uppercase tracking-wide text-muted">
            <th className="py-1.5 pr-3 font-medium">Date</th>
            <th className="py-1.5 pr-3 font-medium">Time</th>
            <th className="py-1.5 pr-3 font-medium">Class</th>
            <th className="py-1.5 pr-3 font-medium">Subject</th>
            <th className="py-1.5 pr-3 font-medium">Venue</th>
            <th className="py-1.5 pr-0" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-border">
              <td className="py-1.5 pr-3">{new Date(row.date).toLocaleDateString()}</td>
              <td className="py-1.5 pr-3 font-mono">
                {row.startTime}–{row.endTime}
              </td>
              <td className="py-1.5 pr-3">{row.classArm.displayName}</td>
              <td className="py-1.5 pr-3">{row.subject.name}</td>
              <td className="py-1.5 pr-3">{row.venue ?? "—"}</td>
              <td className="py-1.5 pr-0 text-right">
                <div className="flex items-center justify-end gap-2">
                  {row.approvalStatus === "PENDING_REVIEW" && (
                    <Badge variant="warning" className="text-[9px]">
                      Pending
                    </Badge>
                  )}
                  <button type="button" onClick={() => onViewClass(row.classArmId)} className="text-[11px] text-primary underline">
                    Edit class
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
