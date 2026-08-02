"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { Label } from "../atoms/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../molecules/select";

interface StudentOption {
  id: string;
  admissionNumber: string;
  user: { firstName: string; lastName: string };
}
interface DepartmentOption {
  id: string;
  name: string;
}
interface AcademicSessionOption {
  id: string;
  name: string;
}

// PRD §3.2/§3.3: assigns a student to a department for a session — the API
// rejects this unless the student's current class level is SSS, surfaced
// here as a plain error banner rather than pre-filtering the student list
// (keeps this form simple; the backend is the single source of truth for
// the rule).
export function StudentDepartmentForm({ onAssigned }: { onAssigned?: () => void }) {
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [sessions, setSessions] = useState<AcademicSessionOption[]>([]);
  const [studentId, setStudentId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [academicSessionId, setAcademicSessionId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiFetch<StudentOption[]>("/students", { auth: true }).then(setStudents).catch(() => setStudents([]));
    apiFetch<DepartmentOption[]>("/departments", { auth: true }).then(setDepartments).catch(() => setDepartments([]));
    apiFetch<AcademicSessionOption[]>("/academic-sessions", { auth: true }).then(setSessions).catch(() => setSessions([]));
  }, []);

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
        <Label htmlFor="sd-student">Student</Label>
        <Select value={studentId} onValueChange={setStudentId}>
          <SelectTrigger id="sd-student" className="mt-1">
            <SelectValue placeholder="Select student" />
          </SelectTrigger>
          <SelectContent>
            {students.map((student) => (
              <SelectItem key={student.id} value={student.id}>
                {student.user.firstName} {student.user.lastName} ({student.admissionNumber})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
