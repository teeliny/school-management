"use client";

import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { formatPersonName } from "@school/types";
import { apiFetch, ApiError } from "../../lib/api";
import { SkeletonTable } from "../molecules/skeleton-table";
import { EmptyState } from "../molecules/empty-state";

interface AllStaffAttendanceAnalytics {
  termId: string;
  schoolDaysOpened: number;
  staff: {
    staffId: string;
    employeeId: string | null;
    firstName: string | null;
    lastName: string | null;
    present: number;
    absent: number;
    late: number;
    excused: number;
    percentage: number | null;
  }[];
  schoolAveragePercentage: number | null;
}

/**
 * Whole-school staff counterpart to `AttendanceTermSummary` (which is
 * per-class-arm, student-only) — `GET /attendance/analytics/staff` is
 * CASL-gated to `read AttendanceSession` (Super-Admin/Admin/Registrar/
 * Principal/Headteacher/Vice-Principal), same as the mode gate that shows
 * "Staff register"/the daily staff absentee list. The caller decides
 * whether to mount this; it doesn't re-check visibility itself.
 */
export function StaffAttendanceTermSummary({ termId }: { termId: string }) {
  const [data, setData] = useState<AllStaffAttendanceAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    apiFetch<AllStaffAttendanceAnalytics>(`/attendance/analytics/staff?termId=${termId}`, { auth: true })
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load staff attendance summary"));
  }, [termId]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!data) return <SkeletonTable rows={4} columns={6} />;

  return (
    <div className="space-y-2.5">
      <p className="text-[12px] text-muted">
        {data.schoolDaysOpened} school day(s) opened this term
        {data.schoolAveragePercentage !== null && <> · staff average {data.schoolAveragePercentage}%</>}
      </p>
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full text-left text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-muted">
              <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Staff</th>
              <th className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide">P</th>
              <th className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide">A</th>
              <th className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide">L</th>
              <th className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide">E</th>
              <th className="py-2 text-[10px] font-medium uppercase tracking-wide">%</th>
            </tr>
          </thead>
          <tbody>
            {data.staff.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <EmptyState icon={Users} title="No active staff" />
                </td>
              </tr>
            )}
            {data.staff.map((staff) => (
              <tr key={staff.staffId} className="border-b border-border/60 last:border-none even:bg-card-inset">
                <td className="py-2.5 pr-4 font-medium">
                  {formatPersonName({ firstName: staff.firstName ?? "", lastName: staff.lastName ?? "" })}{" "}
                  {staff.employeeId && <span className="font-mono text-muted">({staff.employeeId})</span>}
                </td>
                <td className="py-2.5 pr-3 font-mono">{staff.present}</td>
                <td className="py-2.5 pr-3 font-mono">{staff.absent}</td>
                <td className="py-2.5 pr-3 font-mono">{staff.late}</td>
                <td className="py-2.5 pr-3 font-mono">{staff.excused}</td>
                <td className="py-2.5 font-mono">{staff.percentage ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
