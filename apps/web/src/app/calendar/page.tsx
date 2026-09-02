"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCurrentUser } from "../../lib/use-current-user";
import { apiFetch, ApiError } from "../../lib/api";
import { AppShell } from "../../components/templates/app-shell";
import { PageLoadingSkeleton } from "../../components/templates/page-loading-skeleton";
import { Letterhead } from "../../components/molecules/letterhead";
import { Card, CardHeader } from "../../components/molecules/card";
import { Label } from "../../components/atoms/label";
import { Input } from "../../components/atoms/input";
import { Badge, type BadgeVariant } from "../../components/atoms/badge";

type CalendarEntryType =
  | "TERM"
  | "ASSESSMENT_OPEN"
  | "ASSESSMENT_CLOSE"
  | "ASSESSMENT_PUBLISH"
  | "EXAM_PERIOD"
  | "REPORT_WINDOW_OPEN"
  | "REPORT_WINDOW_CLOSE"
  | "HOLIDAY"
  | "SCHOOL_EVENT";

interface CalendarEntry {
  type: CalendarEntryType;
  title: string;
  date: string;
  endDate?: string;
  meta?: Record<string, string>;
}

const TYPE_VARIANT: Record<CalendarEntryType, BadgeVariant> = {
  TERM: "muted",
  ASSESSMENT_OPEN: "success",
  ASSESSMENT_CLOSE: "warning",
  ASSESSMENT_PUBLISH: "info",
  EXAM_PERIOD: "warning",
  REPORT_WINDOW_OPEN: "success",
  REPORT_WINDOW_CLOSE: "warning",
  HOLIDAY: "muted",
  SCHOOL_EVENT: "info",
};

// PRD §3.11: visibility is the same GET /calendar response for everyone —
// which types are worth *showing* by default is deliberately a frontend
// decision. ASSESSMENT_OPEN/CLOSE and REPORT_WINDOW_OPEN/CLOSE are the
// staff-facing input-window mechanics (when a subject/class teacher may key
// in scores or comments); a parent/student doesn't act on those and doesn't
// need them — they get the publish date and the actual EXAM_PERIOD (when the
// mid-term/exam is sat) instead. Staff/Admin see everything.
const STAFF_ONLY_TYPES: CalendarEntryType[] = ["ASSESSMENT_OPEN", "ASSESSMENT_CLOSE", "REPORT_WINDOW_OPEN", "REPORT_WINDOW_CLOSE"];

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default function CalendarPage() {
  const { user, loading, logout } = useCurrentUser();
  const [from, setFrom] = useState(() => toDateInputValue(new Date()));
  const [to, setTo] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return toDateInputValue(d);
  });
  const [entries, setEntries] = useState<CalendarEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!from || !to) return;
    apiFetch<CalendarEntry[]>(`/calendar?from=${from}&to=${to}`, { auth: true })
      .then(setEntries)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load calendar"));
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const isStaffOrAdmin = user
    ? user.roles.includes("SUPER_ADMIN") || user.roles.includes("ADMIN") || user.roles.includes("STAFF")
    : false;

  const groups = useMemo(() => {
    if (!entries) return [];
    const visible = isStaffOrAdmin ? entries : entries.filter((entry) => !STAFF_ONLY_TYPES.includes(entry.type));
    const byDate = new Map<string, CalendarEntry[]>();
    for (const entry of visible) {
      const key = entry.date.slice(0, 10);
      const list = byDate.get(key) ?? [];
      list.push(entry);
      byDate.set(key, list);
    }
    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [entries, isStaffOrAdmin]);

  if (loading) {
    return <PageLoadingSkeleton />;
  }
  if (!user) return null;

  return (
    <AppShell user={user} onLogout={logout}>
      <Letterhead eyebrow="Assessment · Calendar" title="Calendar" />

      <Card>
        <CardHeader
          title="Upcoming dates"
          sub={
            isStaffOrAdmin
              ? "Term boundaries, assessment/report input windows and publish dates, exam periods, public holidays, and school events"
              : "Term boundaries, exam dates, result publish dates, public holidays, and school events"
          }
        />

        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="cal-from">From</Label>
            <Input id="cal-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="cal-to">To</Label>
            <Input id="cal-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}
        {!error && !entries && <p className="text-sm text-muted">Loading…</p>}
        {!error && entries && entries.length === 0 && (
          <p className="text-sm text-muted">No dates in this range.</p>
        )}

        {!error && groups.length > 0 && (
          <div className="space-y-4">
            {groups.map(([dateKey, dayEntries]) => (
              <div key={dateKey}>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
                  {new Date(dateKey).toLocaleDateString(undefined, {
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </p>
                <div className="space-y-1.5">
                  {dayEntries.map((entry, i) => (
                    <div
                      key={`${dateKey}-${i}`}
                      className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
                    >
                      <Badge variant={TYPE_VARIANT[entry.type]}>{entry.type.replace(/_/g, " ")}</Badge>
                      <span className="text-[13px]">{entry.title}</span>
                      {entry.endDate && (
                        <span className="ml-auto font-mono text-[11.5px] text-muted">
                          → {new Date(entry.endDate).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </AppShell>
  );
}
