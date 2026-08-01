"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Badge, type BadgeVariant } from "../atoms/badge";

interface StudentListItem {
  id: string;
  admissionNumber: string;
  status: string;
  currentClassId: string | null;
  user: { firstName: string; lastName: string };
}

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  ACTIVE: "success",
  GRADUATED: "info",
  WITHDRAWN: "muted",
  SUSPENDED: "danger",
};

/**
 * Renders whatever `GET /students` returns — the API already applies PRD §5's
 * row-level scoping (all students for Admin/Super-Admin, own class for a
 * class/subject teacher, own wards for a parent, self for a student), so
 * this component doesn't branch on role at all.
 */
export function PeopleList({ refreshKey }: { refreshKey?: unknown }) {
  const [students, setStudents] = useState<StudentListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<StudentListItem[]>("/students", { auth: true })
      .then(setStudents)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load students"));
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!students) return <p className="text-sm text-muted">Loading…</p>;
  if (students.length === 0) return <p className="text-sm text-muted">No students visible to you yet.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[12.5px]">
        <thead>
          <tr className="border-b border-border text-muted">
            <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Admission #</th>
            <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Name</th>
            <th className="py-2 text-[10px] font-medium uppercase tracking-wide">Status</th>
          </tr>
        </thead>
        <tbody>
          {students.map((student) => (
            <tr key={student.id} className="border-b border-border/60 last:border-none">
              <td className="py-2.5 pr-4 font-mono text-muted">{student.admissionNumber}</td>
              <td className="py-2.5 pr-4 font-medium">
                {student.user.firstName} {student.user.lastName}
              </td>
              <td className="py-2.5">
                <Badge variant={STATUS_VARIANT[student.status] ?? "muted"}>{student.status}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
