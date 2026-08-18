"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import type { CurrentUser } from "../../lib/use-current-user";
import { useCurrentTerm } from "../../lib/use-current-term";
import { Card, CardHeader } from "../molecules/card";
import { Badge } from "../atoms/badge";

interface BroadsheetRow {
  studentId: string;
  studentName: string;
  classArmName: string;
  overallAverage: number | null;
  overallGrade: string | null;
}
interface BroadsheetSnapshot {
  computedAt: string;
  topStudents: BroadsheetRow[];
  bottomStudents: BroadsheetRow[];
}
interface ScheduleApprovalRow {
  scope: "CLASS_TIMETABLE" | "EXAM_TIMETABLE" | "INVIGILATION" | "WEEKLY_DUTY";
  pendingCount: number;
}
interface DutyAssignmentRow {
  id: string;
  weekStartDate: string;
  classLevelCategoryGroup: string;
}

const SCOPE_LABEL: Record<ScheduleApprovalRow["scope"], string> = {
  CLASS_TIMETABLE: "Class timetable",
  EXAM_TIMETABLE: "Exam timetable",
  INVIGILATION: "Invigilation",
  WEEKLY_DUTY: "Weekly duty",
};

/**
 * PRD FR9.6 PRINCIPAL/HEADTEACHER additions. The broadsheet snapshot is
 * deliberately live-computed, not cached (see DashboardService.
 * broadsheetSnapshot's comment on why) — "last updated" always reads as the
 * request time, honestly. Only the overall average/grade is shown per
 * student, not a full subject-by-subject grid — the merged top-5/bottom-5
 * spans every class level in the caller's group (e.g. JSS1 through SSS3 for
 * a Principal), which don't share one subject column set, so a single
 * unified "subject avg columns" table doesn't apply here the way it does on
 * the full /broadsheet page (linked out to for the real per-subject grid).
 */
export function PrincipalHeadteacherAdditions({ user }: { user: CurrentUser }) {
  const { termId } = useCurrentTerm();
  const [snapshot, setSnapshot] = useState<BroadsheetSnapshot | null>(null);
  const [scheduleApprovals, setScheduleApprovals] = useState<ScheduleApprovalRow[] | null>(null);
  const [duties, setDuties] = useState<DutyAssignmentRow[] | null>(null);

  const isPrincipal = user.assignmentTypes.includes("PRINCIPAL");
  const isHeadteacher = user.assignmentTypes.includes("HEADTEACHER");

  useEffect(() => {
    if (!termId || (!isPrincipal && !isHeadteacher)) return;
    apiFetch<BroadsheetSnapshot>(`/dashboard/broadsheet-snapshot?termId=${termId}`, { auth: true })
      .then(setSnapshot)
      .catch(() => setSnapshot(null));
  }, [termId, isPrincipal, isHeadteacher]);

  useEffect(() => {
    if (!isPrincipal && !isHeadteacher) return;
    apiFetch<ScheduleApprovalRow[]>("/dashboard/schedule-approvals-summary", { auth: true })
      .then(setScheduleApprovals)
      .catch(() => setScheduleApprovals([]));

    const group = isPrincipal ? "JSS_SSS" : "CRECHE_NURSERY_PRIMARY";
    const today = new Date().toISOString().slice(0, 10);
    apiFetch<DutyAssignmentRow[]>(`/duty-assignments?classLevelCategoryGroup=${group}&weekStartDateFrom=${today}`, { auth: true })
      .then(setDuties)
      .catch(() => setDuties([]));
  }, [isPrincipal, isHeadteacher]);

  if (!isPrincipal && !isHeadteacher) return null;

  return (
    <div className="mt-4 space-y-4">
      <Card>
        <CardHeader
          title="Broadsheet snapshot"
          sub={snapshot ? `As of ${new Date(snapshot.computedAt).toLocaleString()}` : undefined}
          action={
            <a href="/broadsheet" className="text-[12.5px] font-medium text-primary underline hover:no-underline">
              View full broadsheet
            </a>
          }
        />
        {snapshot ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <BroadsheetMiniTable title="Top 5" rows={snapshot.topStudents} />
            <BroadsheetMiniTable title="Bottom 5" rows={snapshot.bottomStudents} />
          </div>
        ) : (
          <p className="text-sm text-muted">Loading…</p>
        )}
      </Card>

      <Card>
        <CardHeader title="Schedule generation/approval queue" sub="Scoped to your class-level group" />
        {scheduleApprovals ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {scheduleApprovals.map((row) => (
              <a
                key={row.scope}
                href="/planner"
                className="rounded-lg border border-border p-3 text-center transition hover:border-primary/40"
              >
                <div className="font-display text-[22px] font-semibold">{row.pendingCount}</div>
                <div className="mt-0.5 text-[11px] uppercase tracking-wide text-muted">{SCOPE_LABEL[row.scope]}</div>
              </a>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">Loading…</p>
        )}
      </Card>

      <Card>
        <CardHeader title="Duty roster upcoming" sub="Next weeks, your class-level group" />
        {duties && duties.length > 0 ? (
          <ul className="space-y-1.5 text-[12.5px]">
            {duties.map((d) => (
              <li key={d.id} className="flex items-center justify-between rounded-lg border border-border p-2.5">
                <span>Week of {new Date(d.weekStartDate).toLocaleDateString()}</span>
                <Badge variant="muted">{d.classLevelCategoryGroup}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">{duties ? "No upcoming duty roster." : "Loading…"}</p>
        )}
      </Card>
    </div>
  );
}

function BroadsheetMiniTable({ title, rows }: { title: string; rows: BroadsheetRow[] }) {
  return (
    <div>
      <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">{title}</div>
      {rows.length === 0 ? (
        <p className="text-[12.5px] text-muted">No scored students yet.</p>
      ) : (
        <table className="w-full text-[12.5px]">
          <tbody>
            {rows.map((row) => (
              <tr key={row.studentId} className="border-t border-border">
                <td className="py-1 pr-2">
                  {row.studentName} <span className="text-muted">({row.classArmName})</span>
                </td>
                <td className="py-1 text-right font-mono">
                  {row.overallAverage !== null ? `${row.overallAverage.toFixed(1)} (${row.overallGrade})` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
