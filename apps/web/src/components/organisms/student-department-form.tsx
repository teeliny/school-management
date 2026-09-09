"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { Label } from "../atoms/label";
import { StudentMultiCombobox } from "../molecules/student-multi-combobox";
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

// PRD §3.2/§3.3: assigns students to a department for a session — the API
// rejects this unless a student's current class level is SSS. The student
// picker is scoped to SSS up front (StudentMultiCombobox's
// classLevelCategory), but the backend check stays the real authority —
// same "narrow the UI, but don't trust it alone" precedent as everywhere
// else in this app.
//
// The create endpoint only takes one studentId per call (no bulk route), so
// picking several students here just fires one POST per student via
// Promise.allSettled — that also means a partial failure reports per-student
// instead of losing the whole batch. POST doubles as re-assign: the API
// upserts on [studentId, academicSessionId], so picking a student who
// already has a department for this session just moves them to the new one
// instead of 409ing.
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
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [studentLabels, setStudentLabels] = useState<string[]>([]);
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
      const results = await Promise.allSettled(
        studentIds.map((studentId) =>
          apiFetch("/student-departments", {
            method: "POST",
            auth: true,
            body: { studentId, departmentId, academicSessionId },
          }),
        ),
      );
      const failures = results
        .map((result, i) => ({ result, label: studentLabels[i] }))
        .filter(
          (entry): entry is { result: PromiseRejectedResult; label: string } => entry.result.status === "rejected",
        );

      if (failures.length === 0) {
        setSuccess(`Assigned department to ${studentIds.length} student${studentIds.length === 1 ? "" : "s"}.`);
        setStudentIds([]);
        setStudentLabels([]);
      } else if (failures.length < studentIds.length) {
        const failedNames = failures.map((f) => f.label).join(", ");
        setError(`Assigned ${studentIds.length - failures.length} of ${studentIds.length}. Failed: ${failedNames}`);
      } else {
        const reason = failures[0]?.result.reason;
        setError(reason instanceof ApiError ? reason.message : "Something went wrong");
      }

      apiFetch<StudentDepartmentRow[]>(`/student-departments?academicSessionId=${academicSessionId}`, { auth: true })
        .then(setExistingAssignments)
        .catch(() => {});
      onAssigned?.();
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
        <Label htmlFor="sd-student">Students (SSS only)</Label>
        <StudentMultiCombobox
          id="sd-student"
          classLevelCategory="SSS"
          value={studentIds}
          onValueChange={(ids, labels) => {
            setStudentIds(ids);
            setStudentLabels(labels);
          }}
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

      <Button type="submit" disabled={submitting || studentIds.length === 0} className="w-full">
        {submitting
          ? "Assigning…"
          : studentIds.length > 1
            ? `Assign department to ${studentIds.length} students`
            : "Assign department"}
      </Button>
    </form>
  );
}
