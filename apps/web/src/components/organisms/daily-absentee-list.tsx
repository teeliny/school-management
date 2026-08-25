"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Badge, type BadgeVariant } from "../atoms/badge";
import { Label } from "../atoms/label";
import { FormField } from "../molecules/form-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";
import { MultiSelect } from "../molecules/multi-select";

type IssueStatus = "ABSENT" | "LATE" | "EXCUSED" | "NOT_MARKED";

interface IssueEntry {
  studentId: string;
  admissionNumber: string | null;
  firstName: string | null;
  lastName: string | null;
  status: IssueStatus;
  remark: string | null;
}
interface ClassArmSession {
  sessionId: string | null;
  period: string | null;
  taken: boolean;
  entries: IssueEntry[];
}
interface ClassArmIssues {
  classArmId: string;
  className: string;
  sessions: ClassArmSession[];
}
interface DailyAttendanceIssuesResponse {
  date: string;
  classArms: ClassArmIssues[];
}

const ALL_CLASSES = "";

const STATUS_OPTIONS: { value: IssueStatus; label: string }[] = [
  { value: "ABSENT", label: "Absent" },
  { value: "LATE", label: "Late" },
  { value: "EXCUSED", label: "Excused" },
  { value: "NOT_MARKED", label: "Not marked" },
];
const ALL_STATUSES = STATUS_OPTIONS.map((o) => o.value);
const STATUS_BADGE_VARIANT: Record<IssueStatus, BadgeVariant> = {
  ABSENT: "danger",
  LATE: "warning",
  EXCUSED: "info",
  NOT_MARKED: "muted",
};
const STATUS_LABEL: Record<IssueStatus, string> = {
  ABSENT: "Absent",
  LATE: "Late",
  EXCUSED: "Excused",
  NOT_MARKED: "Not marked",
};

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * `GET /attendance/analytics/daily-issues` is CASL-gated to `read
 * AttendanceSession` — true for Super-Admin/Admin/Registrar/Principal/
 * Headteacher only (ability.factory.ts), with Principal/Headteacher narrowed
 * server-side to their own class-level category. The caller decides whether
 * to mount this; it doesn't re-check visibility itself.
 *
 * Both filters are applied client-side over the already-scoped response
 * rather than as server query params — the payload is one school's one-day
 * roll, small enough that a second round trip per filter change isn't worth
 * it, and the class-arm filter's own options are sourced from the response
 * so a Principal/Headteacher never sees a class outside scope.
 */
export function DailyAbsenteeList() {
  const [date, setDate] = useState(todayInput());
  const [classArmId, setClassArmId] = useState(ALL_CLASSES);
  const [statuses, setStatuses] = useState<string[]>(ALL_STATUSES);
  const [data, setData] = useState<DailyAttendanceIssuesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    apiFetch<DailyAttendanceIssuesResponse>(`/attendance/analytics/daily-issues?date=${date}`, { auth: true })
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load attendance list"));
  }, [date]);

  // Reset the class filter if it no longer names a class in the newly-loaded
  // (possibly rescoped) response, rather than silently filtering to nothing.
  useEffect(() => {
    if (data && classArmId && !data.classArms.some((arm) => arm.classArmId === classArmId)) {
      setClassArmId(ALL_CLASSES);
    }
  }, [data, classArmId]);

  const visibleClassArms = useMemo(() => {
    if (!data) return [];
    return classArmId ? data.classArms.filter((arm) => arm.classArmId === classArmId) : data.classArms;
  }, [data, classArmId]);

  const rows = useMemo(
    () =>
      visibleClassArms.flatMap((arm) =>
        arm.sessions.flatMap((session) =>
          session.entries
            .filter((entry) => statuses.includes(entry.status))
            .map((entry) => ({
              key: `${session.sessionId ?? "untaken"}:${entry.studentId}:${session.period ?? ""}`,
              className: arm.className,
              period: session.period,
              ...entry,
            })),
        ),
      ),
    [visibleClassArms, statuses],
  );

  return (
    <div className="space-y-3">
      <div className="grid max-w-[640px] grid-cols-3 gap-3">
        <FormField label="Date" id="absentee-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <div>
          <Label htmlFor="absentee-class-arm">Class / class arm</Label>
          <Select value={classArmId || ALL_CLASSES} onValueChange={(v) => setClassArmId(v === ALL_CLASSES ? "" : v)}>
            <SelectTrigger id="absentee-class-arm" className="mt-1">
              <SelectValue placeholder="All classes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CLASSES}>All classes</SelectItem>
              {(data?.classArms ?? []).map((arm) => (
                <SelectItem key={arm.classArmId} value={arm.classArmId}>
                  {arm.className}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="absentee-status">Status</Label>
          <MultiSelect
            id="absentee-status"
            value={statuses}
            onValueChange={setStatuses}
            options={STATUS_OPTIONS}
            placeholder="All statuses"
            allLabel="All statuses"
            className="mt-1"
          />
        </div>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      {!error && !data && <p className="text-sm text-muted">Loading…</p>}

      {data && data.classArms.length === 0 && <p className="text-sm text-muted">No class arms in scope.</p>}

      {data && data.classArms.length > 0 && (
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Student</th>
                <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Class</th>
                <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Status</th>
                <th className="py-2 text-[10px] font-medium uppercase tracking-wide">Remark</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-3 text-muted">
                    No matching students for this date.
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.key} className="border-b border-border/60 last:border-none">
                  <td className="py-2.5 pr-4 font-medium">
                    {row.firstName} {row.lastName}{" "}
                    {row.admissionNumber && <span className="font-mono text-muted">({row.admissionNumber})</span>}
                  </td>
                  <td className="py-2.5 pr-4 text-muted">
                    {row.className}
                    {row.period ? ` · ${row.period}` : ""}
                  </td>
                  <td className="py-2.5 pr-4">
                    <Badge variant={STATUS_BADGE_VARIANT[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                  </td>
                  <td className="py-2.5 text-muted">{row.remark ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
