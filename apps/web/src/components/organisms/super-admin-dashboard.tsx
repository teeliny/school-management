"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { formatCurrency } from "../../lib/currency";
import type { CurrentUser } from "../../lib/use-current-user";
import { useCurrentTerm } from "../../lib/use-current-term";
import { Card, CardHeader } from "../molecules/card";
import { ProgressBar } from "../molecules/progress-bar";
import { DonutChart, LineChart } from "../molecules/chart";
import { StatCard } from "../atoms/stat-card";
import { Badge } from "../atoms/badge";
import { PendingApprovalsQueue } from "./pending-approvals-queue";

interface FinanceOverview {
  outstandingSchoolWide: number;
  outstandingTrendVsLastTerm: number | null;
  invoicesByStatus: Record<"UNPAID" | "PARTIAL" | "PAID" | "OVERDUE", number>;
  reconciliationStuckCount: number;
}
interface SchoolComposition {
  totalStudents: number;
  totalStaff: number;
  totalParents: number;
}
interface AuditHighlight {
  id: string;
  createdAt: string;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
}
interface InvitationTrendRow {
  weekStart: string;
  role: string;
  sent: number;
  accepted: number;
}
interface ScheduleApprovalRow {
  scope: "CLASS_TIMETABLE" | "EXAM_TIMETABLE" | "INVIGILATION" | "WEEKLY_DUTY";
  pendingCount: number;
}
interface ClassArmOption {
  id: string;
  displayName: string;
}
interface ReportCardProgress {
  totalStudents: number;
  generatedCount: number;
}

const SCOPE_LABEL: Record<ScheduleApprovalRow["scope"], string> = {
  CLASS_TIMETABLE: "Class timetable",
  EXAM_TIMETABLE: "Exam timetable",
  INVIGILATION: "Invigilation",
  WEEKLY_DUTY: "Weekly duty",
};

/**
 * PRD FR9.4: Super-Admin's dashboard — every widget backed by either the new
 * /dashboard/* aggregate endpoints or an existing endpoint reused as-is
 * (PendingApprovalsQueue already covers the discount-requests/manual-
 * payments queue, gated the same "assumes caller already checked
 * SUPER_ADMIN" way this component itself is gated by the caller).
 */
export function SuperAdminDashboard({ user }: { user: CurrentUser }) {
  const { academicSessionId, termId } = useCurrentTerm();
  const [finance, setFinance] = useState<FinanceOverview | null>(null);
  const [composition, setComposition] = useState<SchoolComposition | null>(null);
  const [audit, setAudit] = useState<AuditHighlight[] | null>(null);
  const [invitationTrend, setInvitationTrend] = useState<InvitationTrendRow[] | null>(null);
  const [scheduleApprovals, setScheduleApprovals] = useState<ScheduleApprovalRow[] | null>(null);
  const [reportCardPublishPct, setReportCardPublishPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!termId) return;
    apiFetch<FinanceOverview>(`/dashboard/finance-overview?termId=${termId}`, { auth: true })
      .then(setFinance)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load finance overview"));
  }, [termId]);

  useEffect(() => {
    if (!academicSessionId) return;
    apiFetch<SchoolComposition>(`/dashboard/school-composition?academicSessionId=${academicSessionId}`, { auth: true })
      .then(setComposition)
      .catch(() => setComposition(null));
  }, [academicSessionId]);

  useEffect(() => {
    apiFetch<AuditHighlight[]>("/dashboard/audit-highlights?take=10", { auth: true })
      .then(setAudit)
      .catch(() => setAudit([]));
    apiFetch<InvitationTrendRow[]>("/dashboard/invitation-trend?weeks=8", { auth: true })
      .then(setInvitationTrend)
      .catch(() => setInvitationTrend([]));
    apiFetch<ScheduleApprovalRow[]>("/dashboard/schedule-approvals-summary", { auth: true })
      .then(setScheduleApprovals)
      .catch(() => setScheduleApprovals([]));
  }, []);

  useEffect(() => {
    if (!academicSessionId || !termId) return;
    apiFetch<ClassArmOption[]>(`/class-arms?academicSessionId=${academicSessionId}`, { auth: true })
      .then(async (arms) => {
        const progresses = await Promise.all(
          arms.map((arm) =>
            apiFetch<ReportCardProgress>(`/term-report-cards/progress?classArmId=${arm.id}&termId=${termId}`, { auth: true }).catch(
              () => null,
            ),
          ),
        );
        const totals = progresses.reduce<{ totalStudents: number; generatedCount: number }>(
          (acc, p) =>
            p ? { totalStudents: acc.totalStudents + p.totalStudents, generatedCount: acc.generatedCount + p.generatedCount } : acc,
          { totalStudents: 0, generatedCount: 0 },
        );
        setReportCardPublishPct(totals.totalStudents > 0 ? (totals.generatedCount / totals.totalStudents) * 100 : 0);
      })
      .catch(() => setReportCardPublishPct(null));
  }, [academicSessionId, termId]);

  if (!user.roles.includes("SUPER_ADMIN")) return null;

  const weeklyAcceptanceRate = aggregateWeeklyAcceptanceRate(invitationTrend ?? []);

  return (
    <div className="mt-4 space-y-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      <Card>
        <CardHeader title="School overview" sub="Headline counts across the school" />
        {composition ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label="Total students" value={composition.totalStudents} />
            <StatCard label="Total staff" value={composition.totalStaff} />
            <StatCard label="Total parents" value={composition.totalParents} />
          </div>
        ) : (
          <p className="text-sm text-muted">Loading…</p>
        )}
      </Card>

      <Card>
        <CardHeader title="Finance" sub="School-wide fees position" />
        {finance ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <StatCard
                label="Outstanding fees"
                value={formatCurrency(finance.outstandingSchoolWide)}
                trend={
                  finance.outstandingTrendVsLastTerm === null
                    ? undefined
                    : {
                        direction: finance.outstandingTrendVsLastTerm >= 0 ? "up" : "down",
                        label: `${formatCurrency(Math.abs(finance.outstandingTrendVsLastTerm))} vs last term`,
                        tone: finance.outstandingTrendVsLastTerm >= 0 ? "negative" : "positive",
                      }
                }
              />
              <StatCard
                label="Payment reconciliation queue"
                value={finance.reconciliationStuckCount}
                tone={finance.reconciliationStuckCount > 0 ? "warning" : "default"}
                sub="Gateway payments stuck > 15 min"
              />
            </div>
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">Invoices by status</div>
              <DonutChart
                data={Object.entries(finance.invoicesByStatus).map(([label, value]) => ({ label, value }))}
                height={160}
              />
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">Loading…</p>
        )}
      </Card>

      <Card>
        <CardHeader title="Discount requests & pending payments" sub="Awaiting your review" />
        <PendingApprovalsQueue />
      </Card>

      <Card>
        <CardHeader title="Invitation acceptance" sub="Weekly acceptance rate, last 8 weeks" />
        {weeklyAcceptanceRate.length > 0 ? (
          <LineChart data={weeklyAcceptanceRate} xKey="weekStart" yKey="acceptanceRate" height={180} />
        ) : (
          <p className="text-sm text-muted">No invitations sent in this window.</p>
        )}
      </Card>

      <Card>
        <CardHeader title="Pending schedule approvals" sub="Generated rosters awaiting review" />
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

      {reportCardPublishPct !== null && (
        <Card>
          <CardHeader title="Report card publish progress" sub="School-wide, this term" />
          <ProgressBar value={reportCardPublishPct} />
        </Card>
      )}

      <Card>
        <CardHeader title="Audit log highlights" sub="Most recent sensitive writes" />
        {audit && audit.length > 0 ? (
          <div className="space-y-1.5">
            {audit.map((row) => (
              <div key={row.id} className="rounded-lg border border-border p-2.5 text-[12.5px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <Badge variant="muted">{row.action}</Badge> {row.entityType}
                    {row.entityId && <span className="font-mono text-muted"> ({row.entityId.slice(0, 8)})</span>}
                  </span>
                  <span className="text-muted">
                    {row.actorName ?? "System"} · {new Date(row.createdAt).toLocaleString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">{audit ? "No recent activity." : "Loading…"}</p>
        )}
      </Card>
    </div>
  );
}

function aggregateWeeklyAcceptanceRate(rows: InvitationTrendRow[]): { weekStart: string; acceptanceRate: number }[] {
  const byWeek = new Map<string, { sent: number; accepted: number }>();
  for (const row of rows) {
    const bucket = byWeek.get(row.weekStart) ?? { sent: 0, accepted: 0 };
    bucket.sent += row.sent;
    bucket.accepted += row.accepted;
    byWeek.set(row.weekStart, bucket);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, { sent, accepted }]) => ({
      weekStart,
      acceptanceRate: sent > 0 ? Math.round((accepted / sent) * 100) : 0,
    }));
}
