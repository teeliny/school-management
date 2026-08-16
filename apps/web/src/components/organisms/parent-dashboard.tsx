"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { formatCurrency } from "../../lib/currency";
import type { CurrentUser } from "../../lib/use-current-user";
import { useCurrentTerm } from "../../lib/use-current-term";
import { Card, CardHeader } from "../molecules/card";
import { Gauge } from "../molecules/progress-bar";
import { StatCard } from "../atoms/stat-card";
import { Badge } from "../atoms/badge";
import { Button } from "../atoms/button";

interface StudentRecord {
  id: string;
  currentClassId: string | null;
  user: { firstName: string; lastName: string };
}
interface InvoiceItem {
  id: string;
  dueDate: string;
  status: string;
  outstandingBalance: number;
}
interface ReportCardItem {
  id: string;
  overallScore: number | null;
  overallGrade: string | null;
  status: string;
  publishedAt: string | null;
}
interface AttendanceSummary {
  percentage: number | null;
  recentAbsences: { date: string }[];
}
interface TimetableSlotItem {
  id: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  subject: { name: string };
  venue: string | null;
}
interface NotificationItem {
  id: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
}
interface PaymentItem {
  id: string;
  amount: number;
  method: string;
  createdAt: string;
  receipt: { pdfUrl: string | null } | null;
}

const TODAY_DAY_OF_WEEK = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"][new Date().getDay()];

/** PRD FR9.8 Parent dashboard — one section per ward. */
export function ParentDashboard({ user }: { user: CurrentUser }) {
  const { academicSessionId, termId } = useCurrentTerm();
  const [children, setChildren] = useState<StudentRecord[] | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[] | null>(null);

  useEffect(() => {
    if (!user.parentProfileId) return;
    apiFetch<StudentRecord[]>("/students", { auth: true })
      .then(setChildren)
      .catch(() => setChildren([]));
  }, [user.parentProfileId]);

  useEffect(() => {
    if (!user.parentProfileId) return;
    apiFetch<{ data: NotificationItem[] }>("/notifications?take=8", { auth: true })
      .then((res) => setNotifications(res.data))
      .catch(() => setNotifications([]));
  }, [user.parentProfileId]);

  if (!user.parentProfileId) return null;
  if (!children || children.length === 0) return null;

  return (
    <div className="mt-4 space-y-4">
      {children.map((child) => (
        <WardSection
          key={child.id}
          child={child}
          academicSessionId={academicSessionId}
          termId={termId}
        />
      ))}

      <Card>
        <CardHeader title="Notifications" />
        {notifications ? (
          notifications.length === 0 ? (
            <p className="text-sm text-muted">No notifications yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {notifications.map((n) => (
                <li key={n.id} className="rounded-lg border border-border p-2.5 text-[12.5px]">
                  <div className={n.isRead ? "text-muted" : "font-semibold"}>
                    {!n.isRead && <Badge variant="info" className="mr-1.5">New</Badge>}
                    {n.title}
                  </div>
                  <div className="mt-0.5 text-muted">{n.body}</div>
                </li>
              ))}
            </ul>
          )
        ) : (
          <p className="text-sm text-muted">Loading…</p>
        )}
      </Card>
    </div>
  );
}

function WardSection({
  child,
  academicSessionId,
  termId,
}: {
  child: StudentRecord;
  academicSessionId: string;
  termId: string;
}) {
  const [invoices, setInvoices] = useState<InvoiceItem[] | null>(null);
  const [reportCard, setReportCard] = useState<ReportCardItem | null>(null);
  const [attendance, setAttendance] = useState<AttendanceSummary | null>(null);
  const [todaySlots, setTodaySlots] = useState<TimetableSlotItem[] | null>(null);
  const [payments, setPayments] = useState<PaymentItem[] | null>(null);

  useEffect(() => {
    apiFetch<InvoiceItem[]>(`/invoices?studentId=${child.id}`, { auth: true })
      .then(setInvoices)
      .catch(() => setInvoices([]));
    apiFetch<PaymentItem[]>(`/payments?studentId=${child.id}`, { auth: true })
      .then(setPayments)
      .catch(() => setPayments([]));
  }, [child.id]);

  useEffect(() => {
    apiFetch<ReportCardItem[]>(`/term-report-cards?studentId=${child.id}`, { auth: true })
      .then((cards) => {
        const published = cards
          .filter((c) => c.status === "PUBLISHED" && c.publishedAt)
          .sort((a, b) => new Date(b.publishedAt!).getTime() - new Date(a.publishedAt!).getTime());
        setReportCard(published[0] ?? null);
      })
      .catch(() => setReportCard(null));
  }, [child.id]);

  useEffect(() => {
    if (!termId) return;
    apiFetch<AttendanceSummary>(`/dashboard/my-attendance-summary?studentId=${child.id}&termId=${termId}`, { auth: true })
      .then(setAttendance)
      .catch(() => setAttendance(null));
  }, [child.id, termId]);

  useEffect(() => {
    if (!child.currentClassId || !academicSessionId || !termId) return;
    apiFetch<TimetableSlotItem[]>(
      `/timetable-slots?classArmId=${child.currentClassId}&academicSessionId=${academicSessionId}&termId=${termId}`,
      { auth: true },
    )
      .then((slots) => setTodaySlots(slots.filter((s) => s.dayOfWeek === TODAY_DAY_OF_WEEK).sort((a, b) => a.startTime.localeCompare(b.startTime))))
      .catch(() => setTodaySlots([]));
  }, [child.currentClassId, academicSessionId, termId]);

  const outstandingTotal = (invoices ?? []).reduce((sum, inv) => sum + inv.outstandingBalance, 0);
  const nextDueInvoice = (invoices ?? [])
    .filter((inv) => inv.outstandingBalance > 0)
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0];

  return (
    <Card>
      <CardHeader title={`${child.user.firstName} ${child.user.lastName}`} sub="Overview this term" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-3">
          {invoices ? (
            <StatCard
              label="Outstanding balance"
              value={formatCurrency(outstandingTotal)}
              sub={nextDueInvoice ? <>Next due {new Date(nextDueInvoice.dueDate).toLocaleDateString()}</> : undefined}
              tone={outstandingTotal > 0 ? "warning" : "default"}
            />
          ) : (
            <p className="text-sm text-muted">Loading…</p>
          )}
          {outstandingTotal > 0 && (
            <Button asChild size="sm">
              <a href="/fees">Pay now</a>
            </Button>
          )}

          <div className="rounded-card border border-border px-4 py-3.5">
            <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">Latest report card</div>
            {reportCard ? (
              <>
                <div className="font-mono text-[13px]">
                  {reportCard.overallScore !== null ? `${Number(reportCard.overallScore).toFixed(1)}%` : "—"}
                  {reportCard.overallGrade && ` (${reportCard.overallGrade})`}
                </div>
                <a href="/report-cards" className="text-[12px] text-primary underline hover:no-underline">
                  View full report
                </a>
              </>
            ) : (
              <p className="text-[12.5px] text-muted">No published report card yet.</p>
            )}
          </div>
        </div>

        <div className="flex flex-col items-center justify-center gap-2 rounded-card border border-border px-4 py-3.5">
          {attendance ? (
            <>
              <Gauge value={attendance.percentage ?? 0} label="This term" />
              {attendance.recentAbsences.length > 0 && (
                <div className="w-full text-[11.5px] text-muted">
                  Recent absences: {attendance.recentAbsences.map((a) => new Date(a.date).toLocaleDateString()).join(", ")}
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted">Loading…</p>
          )}
        </div>

        <div>
          <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">Today's timetable</div>
          {todaySlots ? (
            todaySlots.length === 0 ? (
              <p className="text-[12.5px] text-muted">No classes today.</p>
            ) : (
              <ul className="space-y-1 text-[12.5px]">
                {todaySlots.map((s) => (
                  <li key={s.id} className="flex justify-between">
                    <span>{s.subject.name}</span>
                    <span className="font-mono text-muted">{s.startTime}</span>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <p className="text-sm text-muted">Loading…</p>
          )}
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">Payment history</div>
        {payments ? (
          payments.length === 0 ? (
            <p className="text-[12.5px] text-muted">No payments recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                    <th className="pb-1.5 pr-3">Date</th>
                    <th className="pb-1.5 pr-3">Amount</th>
                    <th className="pb-1.5 pr-3">Method</th>
                    <th className="pb-1.5">Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-t border-border">
                      <td className="py-1.5 pr-3 font-mono text-muted">{new Date(p.createdAt).toLocaleDateString()}</td>
                      <td className="py-1.5 pr-3 font-mono">{formatCurrency(p.amount)}</td>
                      <td className="py-1.5 pr-3">{p.method}</td>
                      <td className="py-1.5">
                        {p.receipt?.pdfUrl ? (
                          <a href={p.receipt.pdfUrl} target="_blank" rel="noreferrer" className="text-primary underline hover:no-underline">
                            View
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <p className="text-sm text-muted">Loading…</p>
        )}
      </div>
    </Card>
  );
}
