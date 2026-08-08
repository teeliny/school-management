"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";

interface ClassArmAttendanceAnalytics {
  classArmId: string;
  termId: string;
  schoolDaysOpened: number;
  students: {
    studentId: string;
    admissionNumber: string;
    firstName: string;
    lastName: string;
    present: number;
    absent: number;
    late: number;
    excused: number;
    percentage: number | null;
  }[];
  classAveragePercentage: number | null;
}

/**
 * `GET /attendance/analytics/class-arms/:id` is CASL-gated to
 * `read AttendanceSession` — true for Admin/Super-Admin/Registrar only, so
 * this is only ever mounted for those roles (the caller decides visibility;
 * this component doesn't re-check it).
 */
export function AttendanceTermSummary({ classArmId, termId }: { classArmId: string; termId: string }) {
  const [data, setData] = useState<ClassArmAttendanceAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    apiFetch<ClassArmAttendanceAnalytics>(`/attendance/analytics/class-arms/${classArmId}?termId=${termId}`, { auth: true })
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load attendance summary"));
  }, [classArmId, termId]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!data) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="space-y-2.5">
      <p className="text-[12px] text-muted">
        {data.schoolDaysOpened} school day(s) opened this term
        {data.classAveragePercentage !== null && <> · class average {data.classAveragePercentage}%</>}
      </p>
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full text-left text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-muted">
              <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Student</th>
              <th className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide">P</th>
              <th className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide">A</th>
              <th className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide">L</th>
              <th className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide">E</th>
              <th className="py-2 text-[10px] font-medium uppercase tracking-wide">%</th>
            </tr>
          </thead>
          <tbody>
            {data.students.length === 0 && (
              <tr>
                <td colSpan={6} className="py-3 text-muted">
                  No students in this class arm.
                </td>
              </tr>
            )}
            {data.students.map((student) => (
              <tr key={student.studentId} className="border-b border-border/60 last:border-none">
                <td className="py-2.5 pr-4 font-medium">
                  {student.firstName} {student.lastName}{" "}
                  <span className="font-mono text-muted">({student.admissionNumber})</span>
                </td>
                <td className="py-2.5 pr-3 font-mono">{student.present}</td>
                <td className="py-2.5 pr-3 font-mono">{student.absent}</td>
                <td className="py-2.5 pr-3 font-mono">{student.late}</td>
                <td className="py-2.5 pr-3 font-mono">{student.excused}</td>
                <td className="py-2.5 font-mono">{student.percentage ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
