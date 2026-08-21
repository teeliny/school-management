"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api";
import type { CurrentUser } from "../../lib/use-current-user";
import { useCurrentTerm } from "../../lib/use-current-term";
import { Card, CardHeader } from "../molecules/card";
import { Gauge } from "../molecules/progress-bar";
import { BarChart } from "../molecules/chart";
import { Badge } from "../atoms/badge";

interface StudentRecord {
  id: string;
  currentClassId: string | null;
  user: { firstName: string; lastName: string };
}
interface TimetableSlotItem {
  id: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  subject: { name: string };
  venue: string | null;
}
interface ScoreEntryItem {
  subjectId: string;
  score: number;
  enteredAt: string;
}
interface SubjectOption {
  id: string;
  name: string;
  isGroup: boolean;
  childSubjects?: { id: string; name: string }[];
}
interface AttendanceSummary {
  percentage: number | null;
}
interface ReportCardItem {
  id: string;
  overallScore: number | null;
  overallGrade: string | null;
  status: string;
  publishedAt: string | null;
}
interface EnrollmentItem {
  subjectId: string;
  subject: { id: string; name: string };
}
interface ClassSubjectItem {
  subjectId: string;
  type: "COMPULSORY" | "GENERAL" | "DEPARTMENT";
}
interface NotificationItem {
  id: string;
  title: string;
  body: string;
  isRead: boolean;
}

const TODAY_DAY_OF_WEEK = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"][new Date().getDay()];
const TYPE_LABEL: Record<ClassSubjectItem["type"], string> = { COMPULSORY: "Compulsory", GENERAL: "General", DEPARTMENT: "Department" };

/** PRD FR9.9 Student dashboard. */
export function StudentDashboard({ user }: { user: CurrentUser }) {
  const { academicSessionId, termId } = useCurrentTerm();
  const [todaySlots, setTodaySlots] = useState<TimetableSlotItem[] | null>(null);
  const [scoresBySubject, setScoresBySubject] = useState<{ subjectName: string; score: number }[] | null>(null);
  const [attendance, setAttendance] = useState<AttendanceSummary | null>(null);
  const [reportCard, setReportCard] = useState<ReportCardItem | null>(null);
  const [enrollmentsByType, setEnrollmentsByType] = useState<Record<string, string[]> | null>(null);

  const { data: students } = useQuery({
    queryKey: ["students"],
    queryFn: () => apiFetch<StudentRecord[]>("/students", { auth: true }),
    enabled: Boolean(user.studentProfileId),
  });
  const self = students?.[0] ?? null;
  const { data: notifications } = useQuery({
    // Same key/shape as NotificationBell's recent-list query (RECENT_TAKE=8
    // there too) so the two share one cached array instead of each keeping
    // its own — queryFn must resolve to the same `NotificationItem[]` shape.
    queryKey: ["notifications", "recent", 8],
    queryFn: () =>
      apiFetch<{ data: NotificationItem[] }>("/notifications?take=8", { auth: true }).then((res) => res.data),
    enabled: Boolean(user.studentProfileId),
  });

  useEffect(() => {
    if (!user.studentProfileId || !termId) return;
    apiFetch<AttendanceSummary>(`/dashboard/my-attendance-summary?studentId=${user.studentProfileId}&termId=${termId}`, { auth: true })
      .then(setAttendance)
      .catch(() => setAttendance(null));
    apiFetch<ReportCardItem[]>(`/term-report-cards?studentId=${user.studentProfileId}`, { auth: true })
      .then((cards) => {
        const published = cards
          .filter((c) => c.status === "PUBLISHED" && c.publishedAt)
          .sort((a, b) => new Date(b.publishedAt!).getTime() - new Date(a.publishedAt!).getTime());
        setReportCard(published[0] ?? null);
      })
      .catch(() => setReportCard(null));
  }, [user.studentProfileId, termId]);

  useEffect(() => {
    if (!self?.currentClassId || !academicSessionId || !termId) return;
    apiFetch<TimetableSlotItem[]>(
      `/timetable-slots?classArmId=${self.currentClassId}&academicSessionId=${academicSessionId}&termId=${termId}`,
      { auth: true },
    )
      .then((slots) => setTodaySlots(slots.filter((s) => s.dayOfWeek === TODAY_DAY_OF_WEEK).sort((a, b) => a.startTime.localeCompare(b.startTime))))
      .catch(() => setTodaySlots([]));
  }, [self?.currentClassId, academicSessionId, termId]);

  useEffect(() => {
    if (!user.studentProfileId) return;
    Promise.all([
      apiFetch<ScoreEntryItem[]>(`/score-entries?studentId=${user.studentProfileId}`, { auth: true }).catch(() => []),
      apiFetch<SubjectOption[]>("/subjects", { auth: true }).catch(() => []),
    ]).then(([scores, subjects]) => {
      // A group subject is never itself scoreable (CLAUDE.md's "flatten
      // isGroup subjects into childSubjects" rule) — ScoreEntry.subjectId
      // always references a plain or child subject, so the lookup map must
      // be built from the flattened list, not the raw top-level response.
      const flatSubjects = subjects.flatMap((s) => (s.isGroup ? (s.childSubjects ?? []) : [{ id: s.id, name: s.name }]));
      const subjectNameById = new Map(flatSubjects.map((s) => [s.id, s.name]));
      const latestBySubject = new Map<string, ScoreEntryItem>();
      for (const score of scores) {
        const existing = latestBySubject.get(score.subjectId);
        if (!existing || new Date(score.enteredAt) > new Date(existing.enteredAt)) latestBySubject.set(score.subjectId, score);
      }
      setScoresBySubject(
        [...latestBySubject.values()].map((s) => ({ subjectName: subjectNameById.get(s.subjectId) ?? "Unknown", score: s.score })),
      );
    });
  }, [user.studentProfileId]);

  useEffect(() => {
    if (!user.studentProfileId || !academicSessionId || !termId) return;
    Promise.all([
      apiFetch<EnrollmentItem[]>(
        `/student-subject-enrollments?studentId=${user.studentProfileId}&academicSessionId=${academicSessionId}&termId=${termId}`,
        { auth: true },
      ).catch(() => []),
      apiFetch<ClassSubjectItem[]>("/class-subjects", { auth: true }).catch(() => []),
    ]).then(([enrollments, classSubjects]) => {
      const typeBySubjectId = new Map(classSubjects.map((cs) => [cs.subjectId, cs.type]));
      const grouped: Record<string, string[]> = {};
      for (const enrollment of enrollments) {
        const type = typeBySubjectId.get(enrollment.subjectId) ?? "GENERAL";
        grouped[type] = grouped[type] ?? [];
        grouped[type].push(enrollment.subject.name);
      }
      setEnrollmentsByType(grouped);
    });
  }, [user.studentProfileId, academicSessionId, termId]);

  if (!user.studentProfileId) return null;

  return (
    <div className="mt-4 space-y-4">
      <Card>
        <CardHeader title="Today's timetable" />
        {todaySlots ? (
          todaySlots.length === 0 ? (
            <p className="text-sm text-muted">No classes today.</p>
          ) : (
            <ul className="space-y-1 text-[12.5px]">
              {todaySlots.map((s) => (
                <li key={s.id} className="flex items-center justify-between rounded-lg border border-border p-2.5">
                  <span>{s.subject.name}</span>
                  <span className="font-mono text-muted">
                    {s.startTime}–{s.endTime}
                    {s.venue && ` · ${s.venue}`}
                  </span>
                </li>
              ))}
            </ul>
          )
        ) : (
          <p className="text-sm text-muted">Loading…</p>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader title="Latest scores per subject" />
          {scoresBySubject ? (
            scoresBySubject.length === 0 ? (
              <p className="text-sm text-muted">No scores entered yet.</p>
            ) : (
              <BarChart data={scoresBySubject} xKey="subjectName" yKey="score" height={220} />
            )
          ) : (
            <p className="text-sm text-muted">Loading…</p>
          )}
        </Card>

        <Card>
          <CardHeader title="Attendance record" sub="This term" />
          <div className="flex items-center justify-center py-2">
            {attendance ? <Gauge value={attendance.percentage ?? 0} /> : <p className="text-sm text-muted">Loading…</p>}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Latest report card"
          action={
            <a href="/report-cards" className="text-[12.5px] font-medium text-primary underline hover:no-underline">
              View
            </a>
          }
        />
        {reportCard ? (
          <div className="font-mono text-[13px]">
            {reportCard.overallScore !== null ? `${Number(reportCard.overallScore).toFixed(1)}%` : "—"}
            {reportCard.overallGrade && ` (${reportCard.overallGrade})`}
          </div>
        ) : (
          <p className="text-sm text-muted">No published report card yet.</p>
        )}
      </Card>

      <Card>
        <CardHeader title="Subject enrollment" />
        {enrollmentsByType ? (
          Object.keys(enrollmentsByType).length === 0 ? (
            <p className="text-sm text-muted">No subject enrollments this term.</p>
          ) : (
            <div className="space-y-3">
              {(["COMPULSORY", "GENERAL", "DEPARTMENT"] as const)
                .filter((type) => enrollmentsByType[type]?.length)
                .map((type) => (
                  <div key={type}>
                    <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">{TYPE_LABEL[type]}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {(enrollmentsByType[type] ?? []).map((name) => (
                        <Badge key={name} variant="muted">
                          {name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          )
        ) : (
          <p className="text-sm text-muted">Loading…</p>
        )}
      </Card>

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
                    {!n.isRead && (
                      <Badge variant="info" className="mr-1.5">
                        New
                      </Badge>
                    )}
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
