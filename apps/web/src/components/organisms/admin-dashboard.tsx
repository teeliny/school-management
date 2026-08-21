"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { CLASS_LEVEL_CATEGORIES, type ClassLevelCategory } from "@school/types";
import { apiFetch } from "../../lib/api";
import type { CurrentUser } from "../../lib/use-current-user";
import { useCurrentTerm } from "../../lib/use-current-term";
import { Card, CardHeader } from "../molecules/card";
import { ProgressBar } from "../molecules/progress-bar";
import { DonutChart } from "../molecules/chart";
import { StatCard } from "../atoms/stat-card";
import { Badge } from "../atoms/badge";

// PRD FR9.1/FR9.5: this organism must never import anything from the
// fees/finance domain (no Invoice/Payment/DiscountRequest fetch, no
// PendingApprovalsQueue reuse) — Admin's dashboard carries zero finance
// data anywhere, unlike Super-Admin's. Every widget below is either one of
// DashboardModule's new Admin-gated aggregate endpoints or an existing
// non-finance endpoint reused as-is.

interface SchoolComposition {
  studentsByLevel: { classLevelId: string; name: string; count: number }[];
  studentsByDepartment: { departmentId: string; name: string; count: number }[];
  staffHeadcount: number;
  unfilledAssignmentGaps: { classArmId: string; className: string; missing: string[] }[];
}
interface AssessmentComponentRow {
  id: string;
  name: string;
  classLevelCategory: ClassLevelCategory;
  inputClosesAt: string | null;
  status: string;
}
interface ScoreEntryCompletionRow {
  classArmId: string;
  className: string;
  subjectName: string;
  componentName: string;
  totalStudents: number;
  enteredCount: number;
}
interface ClassArmOption {
  id: string;
  displayName: string;
}
interface ReadinessResponse {
  totalStudents: number;
  students: { ready: boolean; missing: string[] }[];
}
interface AttendanceAnomalyRow {
  classArmId: string;
  className: string;
  percentageToday: number | null;
  deltaFromTermAverage: number | null;
}
interface ScheduleApprovalRow {
  scope: "CLASS_TIMETABLE" | "EXAM_TIMETABLE" | "INVIGILATION" | "WEEKLY_DUTY";
  pendingCount: number;
}
interface InvitationRow {
  id: string;
  email: string;
  invitedRole: string;
  status: string;
  createdAt: string;
  expiresAt: string;
}
interface BouncedParentRow {
  id: string;
  emailBouncedAt: string | null;
  user: { firstName: string; lastName: string; email: string };
}

const SCOPE_LABEL: Record<ScheduleApprovalRow["scope"], string> = {
  CLASS_TIMETABLE: "Class timetable",
  EXAM_TIMETABLE: "Exam timetable",
  INVIGILATION: "Invigilation",
  WEEKLY_DUTY: "Weekly duty",
};

export function AdminDashboard({ user }: { user: CurrentUser }) {
  const { academicSessionId, termId } = useCurrentTerm();

  const { data: composition } = useQuery({
    queryKey: ["dashboard", "school-composition", academicSessionId],
    queryFn: () => apiFetch<SchoolComposition>(`/dashboard/school-composition?academicSessionId=${academicSessionId}`, { auth: true }),
    enabled: Boolean(academicSessionId),
  });
  const { data: components } = useQuery({
    queryKey: ["assessment-components", termId],
    queryFn: () => apiFetch<AssessmentComponentRow[]>(`/assessment-components?termId=${termId}`, { auth: true }),
    enabled: Boolean(termId),
  });
  const { data: attendanceInsights } = useQuery({
    queryKey: ["dashboard", "attendance-insights", termId],
    queryFn: () => apiFetch<{ anomalies: AttendanceAnomalyRow[] }>(`/dashboard/attendance-insights?termId=${termId}`, { auth: true }),
    enabled: Boolean(termId),
  });
  const anomalies = attendanceInsights?.anomalies ?? null;

  const scoreEntryQueries = useQueries({
    queries: CLASS_LEVEL_CATEGORIES.map((category) => ({
      queryKey: ["dashboard", "score-entry-completion", termId, category],
      queryFn: () =>
        apiFetch<ScoreEntryCompletionRow[]>(
          `/dashboard/score-entry-completion?termId=${termId}&classLevelCategory=${category}`,
          { auth: true },
        ),
      enabled: Boolean(termId),
    })),
  });
  const scoreEntryRows = scoreEntryQueries.every((q) => q.isSuccess || q.isError)
    ? scoreEntryQueries.flatMap((q) => q.data ?? [])
    : null;

  // useQuery/useQueries (rather than a raw fetch-in-effect) so this shares
  // its /class-arms cache with SuperAdminDashboard's identical fetch, and so
  // React StrictMode's dev-mode double-effect-invocation dedupes into one
  // request per class arm instead of firing every readiness call twice.
  const { data: classArms } = useQuery({
    queryKey: ["class-arms", { academicSessionId }],
    queryFn: () => apiFetch<ClassArmOption[]>(`/class-arms?academicSessionId=${academicSessionId}`, { auth: true }),
    enabled: Boolean(academicSessionId),
  });
  const readinessQueries = useQueries({
    queries: (classArms ?? []).map((arm) => ({
      queryKey: ["term-report-cards", "class-readiness", arm.id, termId],
      queryFn: () =>
        apiFetch<ReadinessResponse>(`/term-report-cards/class-readiness?classArmId=${arm.id}&termId=${termId}`, { auth: true }),
      enabled: Boolean(termId),
    })),
  });
  const readinessByClass =
    classArms && readinessQueries.every((q) => q.isSuccess || q.isError)
      ? readinessQueries
          .map((q, i) => {
            const arm = classArms[i];
            if (!arm || !q.data || q.data.totalStudents === 0) return null;
            const readyCount = q.data.students.filter((s) => s.ready).length;
            return { classArmId: arm.id, className: arm.displayName, readyPct: (readyCount / q.data.totalStudents) * 100 };
          })
          .filter((r): r is { classArmId: string; className: string; readyPct: number } => r !== null)
      : null;

  const { data: scheduleApprovals } = useQuery({
    queryKey: ["dashboard", "schedule-approvals-summary"],
    queryFn: () => apiFetch<ScheduleApprovalRow[]>("/dashboard/schedule-approvals-summary", { auth: true }),
  });
  const { data: invitations } = useQuery({
    queryKey: ["invitations"],
    queryFn: () => apiFetch<InvitationRow[]>("/invitations", { auth: true }),
  });
  const { data: bouncedParents } = useQuery({
    queryKey: ["parent-profiles", { emailBounced: true }],
    queryFn: () => apiFetch<BouncedParentRow[]>("/parent-profiles?emailBounced=true", { auth: true }),
  });

  if (!user.roles.includes("ADMIN")) return null;

  return (
    <div className="mt-4 space-y-4">
      <Card>
        <CardHeader title="Enrollment" sub="Total students by class level" />
        {composition ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <DonutChart data={composition.studentsByLevel.map((l) => ({ label: l.name, value: l.count }))} height={180} />
            <div>
              <StatCard label="Staff headcount" value={composition.staffHeadcount} className="mb-3" />
              <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">Unfilled class-teacher assignments</div>
              {composition.unfilledAssignmentGaps.length === 0 ? (
                <p className="text-[12.5px] text-muted">Every class arm has a class teacher.</p>
              ) : (
                <ul className="space-y-1 text-[12.5px]">
                  {composition.unfilledAssignmentGaps.map((gap) => (
                    <li key={gap.classArmId}>
                      <Badge variant="warning">Gap</Badge> {gap.className} — no {gap.missing.join(", ").toLowerCase()}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">Loading…</p>
        )}
      </Card>

      <Card>
        <CardHeader title="Assessment window status" sub="This term's components" />
        {components && components.length > 0 ? (
          <div className="space-y-1.5">
            {components.map((c) => (
              <div key={c.id} className="rounded-lg border border-border p-2.5 text-[12.5px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <Badge variant={c.status === "OPEN" ? "success" : c.status === "PUBLISHED" ? "info" : "muted"}>
                      {c.status}
                    </Badge>{" "}
                    {c.name} <span className="text-muted">({c.classLevelCategory})</span>
                  </span>
                  <span className="font-mono text-muted">{formatCountdown(c.inputClosesAt)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">{components ? "No assessment components this term." : "Loading…"}</p>
        )}
      </Card>

      <Card>
        <CardHeader title="Score entry completion" sub="Currently open components, by class and subject" />
        {scoreEntryRows && scoreEntryRows.length > 0 ? (
          <div className="max-h-[320px] space-y-1.5 overflow-y-auto">
            {scoreEntryRows.map((row) => (
              <div key={`${row.classArmId}-${row.subjectName}-${row.componentName}`} className="text-[12.5px]">
                <div className="mb-0.5 flex items-center justify-between gap-2 text-muted">
                  <span>
                    {row.className} · {row.subjectName} · {row.componentName}
                  </span>
                  <span className="font-mono">
                    {row.enteredCount}/{row.totalStudents}
                  </span>
                </div>
                <ProgressBar value={row.totalStudents > 0 ? (row.enteredCount / row.totalStudents) * 100 : 0} size="sm" />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">{scoreEntryRows ? "No open assessment components right now." : "Loading…"}</p>
        )}
      </Card>

      <Card>
        <CardHeader title="Report card readiness" sub="Share of students with a complete report, by class" />
        {readinessByClass && readinessByClass.length > 0 ? (
          <div className="space-y-2">
            {readinessByClass.map((row) => (
              <div key={row.classArmId} className="text-[12.5px]">
                <div className="mb-0.5 text-muted">{row.className}</div>
                <ProgressBar value={row.readyPct} size="sm" />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">{readinessByClass ? "No classes with students yet." : "Loading…"}</p>
        )}
      </Card>

      <Card>
        <CardHeader title="Pending schedule approvals" sub="View-only — approval is Super-Admin's" />
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
        <CardHeader title="Attendance anomalies" sub="Worst-first, today vs term average" />
        {anomalies && anomalies.length > 0 ? (
          <div className="space-y-1.5">
            {anomalies.map((row) => (
              <div key={row.classArmId} className="flex items-center justify-between rounded-lg border border-border p-2.5 text-[12.5px]">
                <span>{row.className}</span>
                <span className="font-mono">
                  {row.percentageToday}% today
                  {row.deltaFromTermAverage !== null && (
                    <span className={row.deltaFromTermAverage < 0 ? "text-danger" : "text-success"}>
                      {" "}
                      ({row.deltaFromTermAverage >= 0 ? "+" : ""}
                      {row.deltaFromTermAverage} vs avg)
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">{anomalies ? "No attendance taken today yet." : "Loading…"}</p>
        )}
      </Card>

      <Card>
        <CardHeader title="Invitation pipeline" sub="Pending and expired invites" />
        {invitations && invitations.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                  <th className="pb-1.5 pr-3">Email</th>
                  <th className="pb-1.5 pr-3">Role</th>
                  <th className="pb-1.5 pr-3">Status</th>
                  <th className="pb-1.5 pr-3">Sent</th>
                  <th className="pb-1.5">Expires</th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((inv) => (
                  <tr key={inv.id} className="border-t border-border">
                    <td className="py-1.5 pr-3">{inv.email}</td>
                    <td className="py-1.5 pr-3">{inv.invitedRole}</td>
                    <td className="py-1.5 pr-3">
                      <Badge variant={inv.status === "EXPIRED" ? "danger" : "warning"}>{inv.status}</Badge>
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-muted">{new Date(inv.createdAt).toLocaleDateString()}</td>
                    <td className="py-1.5 font-mono text-muted">{new Date(inv.expiresAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted">{invitations ? "No pending invitations." : "Loading…"}</p>
        )}
      </Card>

      <Card>
        <CardHeader title="Bounced parent emails" sub="Flagged by a delivery failure" />
        {bouncedParents && bouncedParents.length > 0 ? (
          <ul className="space-y-1.5 text-[12.5px]">
            {bouncedParents.map((p) => (
              <li key={p.id} className="flex items-center justify-between rounded-lg border border-border p-2.5">
                <span>
                  {p.user.firstName} {p.user.lastName} <span className="text-muted">({p.user.email})</span>
                </span>
                <Badge variant="danger">Flagged</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">{bouncedParents ? "No bounced parent emails." : "Loading…"}</p>
        )}
      </Card>
    </div>
  );
}

function formatCountdown(closesAt: string | null): string {
  if (!closesAt) return "No close date";
  const diffMs = new Date(closesAt).getTime() - Date.now();
  if (diffMs <= 0) return "Closed";
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days > 0) return `${days}d left`;
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  return `${hours}h left`;
}
