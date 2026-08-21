"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { Label } from "../atoms/label";
import { StudentCombobox } from "../molecules/student-combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../molecules/select";

interface DepartmentOption {
  id: string;
  name: string;
}
interface AcademicSessionOption {
  id: string;
  name: string;
  isCurrent: boolean;
}
interface StudentDepartmentRow {
  studentId: string;
  department: { name: string };
}

// PRD §3.2/§3.3: assigns a student to a department for a session — the API
// rejects this unless the student's current class level is SSS. The student
// picker is scoped to SSS up front (StudentCombobox's classLevelCategory),
// but the backend check stays the real authority — same "narrow the UI, but
// don't trust it alone" precedent as everywhere else in this app.
export function StudentDepartmentForm({ onAssigned }: { onAssigned?: () => void }) {
  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: () => apiFetch<DepartmentOption[]>("/departments", { auth: true }),
  });
  const { data: sessions = [] } = useQuery({
    queryKey: ["academic-sessions"],
    queryFn: () => apiFetch<AcademicSessionOption[]>("/academic-sessions", { auth: true }),
  });
  const [existingAssignments, setExistingAssignments] = useState<StudentDepartmentRow[]>([]);
  const [studentId, setStudentId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [academicSessionId, setAcademicSessionId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (academicSessionId || sessions.length === 0) return;
    const current = sessions.find((s) => s.isCurrent);
    if (current) setAcademicSessionId(current.id);
  }, [sessions, academicSessionId]);

  // Existing assignments for the selected session — surfaced per-student in
  // the picker below (via extraLabelsByStudentId) so re-picking an
  // already-assigned student shows their current department instead of
  // looking unassigned.
  useEffect(() => {
    if (!academicSessionId) {
      setExistingAssignments([]);
      return;
    }
    apiFetch<StudentDepartmentRow[]>(`/student-departments?academicSessionId=${academicSessionId}`, { auth: true })
      .then(setExistingAssignments)
      .catch(() => setExistingAssignments([]));
  }, [academicSessionId]);

  const currentDepartmentByStudentId = Object.fromEntries(
    existingAssignments.map((row) => [row.studentId, `currently: ${row.department.name}`]),
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await apiFetch("/student-departments", {
        method: "POST",
        auth: true,
        body: { studentId, departmentId, academicSessionId },
      });
      setSuccess("Department assigned.");
      apiFetch<StudentDepartmentRow[]>(`/student-departments?academicSessionId=${academicSessionId}`, { auth: true })
        .then(setExistingAssignments)
        .catch(() => {});
      onAssigned?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
      {error && <p className="text-sm text-danger">{error}</p>}
      {success && <p className="text-sm text-success">{success}</p>}

      <div>
        <Label htmlFor="sd-session">Academic session</Label>
        <Select value={academicSessionId} onValueChange={setAcademicSessionId}>
          <SelectTrigger id="sd-session" className="mt-1">
            <SelectValue placeholder="Select session" />
          </SelectTrigger>
          <SelectContent>
            {sessions.map((session) => (
              <SelectItem key={session.id} value={session.id}>
                {session.name}
                {session.isCurrent && " (current)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="sd-student">Student (SSS only)</Label>
        <StudentCombobox
          id="sd-student"
          classLevelCategory="SSS"
          value={studentId}
          onValueChange={(id) => setStudentId(id)}
          extraLabelsByStudentId={currentDepartmentByStudentId}
          className="mt-1"
        />
      </div>

      <div>
        <Label htmlFor="sd-department">Department</Label>
        <Select value={departmentId} onValueChange={setDepartmentId}>
          <SelectTrigger id="sd-department" className="mt-1">
            <SelectValue placeholder="Select department" />
          </SelectTrigger>
          <SelectContent>
            {departments.map((dept) => (
              <SelectItem key={dept.id} value={dept.id}>
                {dept.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Assigning…" : "Assign department"}
      </Button>
    </form>
  );
}
