"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";

interface StudentListItem {
  id: string;
  admissionNumber: string;
  status: string;
  currentClassId: string | null;
  user: { firstName: string; lastName: string };
}

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

  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!students) return <p className="text-sm text-muted">Loading…</p>;
  if (students.length === 0) return <p className="text-sm text-muted">No students visible to you yet.</p>;

  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-border text-muted">
          <th className="py-2 pr-4 font-medium">Admission #</th>
          <th className="py-2 pr-4 font-medium">Name</th>
          <th className="py-2 font-medium">Status</th>
        </tr>
      </thead>
      <tbody>
        {students.map((student) => (
          <tr key={student.id} className="border-b border-border">
            <td className="py-2 pr-4">{student.admissionNumber}</td>
            <td className="py-2 pr-4">
              {student.user.firstName} {student.user.lastName}
            </td>
            <td className="py-2">{student.status}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
