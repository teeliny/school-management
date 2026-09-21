"use client";

import { useEffect, useMemo, useState } from "react";
import { UserCheck } from "lucide-react";
import { formatPersonName } from "@school/types";
import { apiFetch, ApiError } from "../../lib/api";
import { Badge, type BadgeVariant } from "../atoms/badge";
import { Label } from "../atoms/label";
import { FormField } from "../molecules/form-field";
import { MultiSelect } from "../molecules/multi-select";
import { SkeletonTable } from "../molecules/skeleton-table";
import { EmptyState } from "../molecules/empty-state";

type IssueStatus = "ABSENT" | "LATE" | "EXCUSED" | "NOT_MARKED";

interface StaffIssueEntry {
  staffId: string;
  employeeId: string | null;
  firstName: string | null;
  lastName: string | null;
  status: IssueStatus;
  remark: string | null;
}
interface DailyStaffAttendanceIssuesResponse {
  date: string;
  sessionId: string | null;
  taken: boolean;
  entries: StaffIssueEntry[];
}

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
 * Staff-side counterpart to `DailyAbsenteeList` — `GET
 * /attendance/analytics/staff/daily-issues` is CASL-gated to `read
 * AttendanceSession` (Super-Admin/Admin/Registrar/Principal/Headteacher/
 * Vice-Principal), same as the mode gate that shows "Staff register" on the
 * Roll Call tab (attendance/page.tsx's `isAdmin || isRegistrar`). Flat list,
 * not grouped by class — staff attendance is always school-wide, one
 * DAILY session for the whole school, never split by class arm or period.
 */
export function StaffDailyAbsenteeList() {
  const [date, setDate] = useState(todayInput());
  const [statuses, setStatuses] = useState<string[]>(ALL_STATUSES);
  const [data, setData] = useState<DailyStaffAttendanceIssuesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    apiFetch<DailyStaffAttendanceIssuesResponse>(`/attendance/analytics/staff/daily-issues?date=${date}`, { auth: true })
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load staff attendance list"));
  }, [date]);

  const rows = useMemo(() => (data ? data.entries.filter((entry) => statuses.includes(entry.status)) : []), [data, statuses]);

  return (
    <div className="space-y-3">
      <div className="grid max-w-[440px] grid-cols-2 gap-3">
        <FormField label="Date" id="staff-absentee-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <div>
          <Label htmlFor="staff-absentee-status">Status</Label>
          <MultiSelect
            id="staff-absentee-status"
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
      {!error && !data && <SkeletonTable rows={4} columns={3} />}

      {data && !data.taken && (
        <p className="text-[12px] text-warning">Staff register has not been taken for this date yet.</p>
      )}

      {data && (
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Staff</th>
                <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Status</th>
                <th className="py-2 text-[10px] font-medium uppercase tracking-wide">Remark</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={3}>
                    <EmptyState icon={UserCheck} title="No matching staff for this date" />
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.staffId} className="border-b border-border/60 last:border-none even:bg-card-inset">
                  <td className="py-2.5 pr-4 font-medium">
                    {formatPersonName({ firstName: row.firstName ?? "", lastName: row.lastName ?? "" })}{" "}
                    {row.employeeId && <span className="font-mono text-muted">({row.employeeId})</span>}
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
