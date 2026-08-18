"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { Label } from "../atoms/label";
import { Badge, type BadgeVariant } from "../atoms/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";
import { SearchableSelect } from "../molecules/searchable-select";
import { StudentCombobox } from "../molecules/student-combobox";
import { TYPE_LABELS, type SubjectType } from "../../lib/subject-applicability";

interface ClassArmOption {
  id: string;
  displayName: string;
  academicSessionId: string;
  classLevel: { category: string };
}
interface TermOption {
  id: string;
  name: string;
}
interface ClassSubjectOption {
  id: string;
  subjectId: string;
  type: SubjectType;
  subject: { name: string; code: string };
}
interface EnrollmentRow {
  id: string;
  subjectId: string;
  status: "ACTIVE" | "DROPPED";
  subject: { name: string; code: string };
}

const STATUS_VARIANT: Record<EnrollmentRow["status"], BadgeVariant> = {
  ACTIVE: "success",
  DROPPED: "muted",
};

// PRD §3.3 FR2.5: explicit GENERAL/DEPARTMENT opt-in for one student — a
// COMPULSORY ClassSubject can't be manually opted into (it auto-enrolls on
// class assignment, StudentSubjectEnrollmentService.syncCompulsoryEnrollmentsOnClassAssignment),
// so it's excluded from the "opt into a subject" picker below; the backend
// is still the single source of truth for that rule (DEPARTMENT mismatches
// surface as a plain error banner here rather than being pre-filtered).
export function StudentSubjectEnrollmentManager() {
  const [classArms, setClassArms] = useState<ClassArmOption[]>([]);
  const [classArmId, setClassArmId] = useState("");
  const [terms, setTerms] = useState<TermOption[]>([]);
  const [termId, setTermId] = useState("");
  const [classSubjects, setClassSubjects] = useState<ClassSubjectOption[]>([]);
  const [studentId, setStudentId] = useState("");
  const [enrollments, setEnrollments] = useState<EnrollmentRow[] | null>(null);
  const [subjectToEnroll, setSubjectToEnroll] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const [droppingId, setDroppingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<ClassArmOption[]>("/class-arms", { auth: true }).then(setClassArms).catch(() => setClassArms([]));
  }, []);

  const selectedClassArm = classArms.find((arm) => arm.id === classArmId) ?? null;

  // A different class arm invalidates the student/term/subject picked for
  // the previous one — same "reset child on parent change" shape used
  // elsewhere (e.g. gradebook's class-arm select).
  useEffect(() => {
    setStudentId("");
    setTermId("");
    setSubjectToEnroll("");
    setEnrollments(null);
  }, [classArmId]);

  useEffect(() => {
    if (!selectedClassArm) {
      setTerms([]);
      return;
    }
    apiFetch<TermOption[]>(`/terms?academicSessionId=${selectedClassArm.academicSessionId}`, { auth: true })
      .then(setTerms)
      .catch(() => setTerms([]));
  }, [selectedClassArm]);

  useEffect(() => {
    if (!selectedClassArm) {
      setClassSubjects([]);
      return;
    }
    apiFetch<ClassSubjectOption[]>(`/class-subjects?classLevelCategory=${selectedClassArm.classLevel.category}`, {
      auth: true,
    })
      .then(setClassSubjects)
      .catch(() => setClassSubjects([]));
  }, [selectedClassArm]);

  const loadEnrollments = useCallback(() => {
    if (!studentId || !termId || !selectedClassArm) {
      setEnrollments(null);
      return;
    }
    apiFetch<EnrollmentRow[]>(
      `/student-subject-enrollments?studentId=${studentId}&academicSessionId=${selectedClassArm.academicSessionId}&termId=${termId}`,
      { auth: true },
    )
      .then(setEnrollments)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load subject enrollments"));
  }, [studentId, termId, selectedClassArm]);

  useEffect(() => {
    loadEnrollments();
  }, [loadEnrollments]);

  // GENERAL/DEPARTMENT subjects only (COMPULSORY can't be manually opted
  // into, per the backend's enroll() rejection) that this student isn't
  // already actively enrolled in this term.
  const eligibleSubjects = useMemo(
    () =>
      classSubjects
        .filter((cs) => cs.type !== "COMPULSORY")
        .filter((cs) => !enrollments?.some((e) => e.subjectId === cs.subjectId && e.status === "ACTIVE")),
    [classSubjects, enrollments],
  );

  async function enroll() {
    if (!selectedClassArm) return;
    setError(null);
    setSuccess(null);
    setEnrolling(true);
    try {
      await apiFetch("/student-subject-enrollments", {
        method: "POST",
        auth: true,
        body: {
          studentId,
          subjectId: subjectToEnroll,
          classArmId,
          academicSessionId: selectedClassArm.academicSessionId,
          termId,
        },
      });
      setSubjectToEnroll("");
      setSuccess("Student enrolled in the subject.");
      loadEnrollments();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to enroll student");
    } finally {
      setEnrolling(false);
    }
  }

  async function drop(id: string) {
    setError(null);
    setSuccess(null);
    setDroppingId(id);
    try {
      await apiFetch(`/student-subject-enrollments/${id}/drop`, { method: "PATCH", auth: true });
      loadEnrollments();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to drop subject enrollment");
    } finally {
      setDroppingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-danger">{error}</p>}
      {success && <p className="text-sm text-success">{success}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="sse-class-arm">Class arm</Label>
          <Select value={classArmId} onValueChange={setClassArmId}>
            <SelectTrigger id="sse-class-arm" className="mt-1">
              <SelectValue placeholder="Select class arm" />
            </SelectTrigger>
            <SelectContent>
              {classArms.map((arm) => (
                <SelectItem key={arm.id} value={arm.id}>
                  {arm.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="sse-student">Student</Label>
          <StudentCombobox
            id="sse-student"
            classArmId={classArmId}
            value={studentId}
            onValueChange={(id) => setStudentId(id)}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="sse-term">Term</Label>
          <Select value={termId} onValueChange={setTermId} disabled={!classArmId}>
            <SelectTrigger id="sse-term" className="mt-1">
              <SelectValue placeholder="Select term" />
            </SelectTrigger>
            <SelectContent>
              {terms.map((term) => (
                <SelectItem key={term.id} value={term.id}>
                  {term.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {studentId && termId && (
        <>
          <div>
            <table className="w-full text-left text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Subject</th>
                  <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Status</th>
                  <th className="py-2 text-[10px] font-medium uppercase tracking-wide" />
                </tr>
              </thead>
              <tbody>
                {enrollments?.map((row) => (
                  <tr key={row.id} className="border-b border-border/60 last:border-none">
                    <td className="py-2.5 pr-4">
                      {row.subject.name} <span className="font-mono text-muted">({row.subject.code})</span>
                    </td>
                    <td className="py-2.5 pr-4">
                      <Badge variant={STATUS_VARIANT[row.status]}>{row.status}</Badge>
                    </td>
                    <td className="py-2.5">
                      {row.status === "ACTIVE" && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={droppingId === row.id}
                          onClick={() => drop(row.id)}
                        >
                          {droppingId === row.id ? "Dropping…" : "Drop"}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {enrollments?.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-2.5 text-muted">
                      No subject enrollments for this student/term yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Label htmlFor="sse-add-subject">Opt into a subject</Label>
              <SearchableSelect
                id="sse-add-subject"
                value={subjectToEnroll}
                onValueChange={setSubjectToEnroll}
                options={eligibleSubjects.map((cs) => ({
                  value: cs.subjectId,
                  label: `${cs.subject.name} (${cs.subject.code}) — ${TYPE_LABELS[cs.type]}`,
                }))}
                placeholder="Select subject"
                searchPlaceholder="Search by name or code…"
                className="mt-1"
              />
            </div>
            <Button type="button" disabled={!subjectToEnroll || enrolling} onClick={enroll}>
              {enrolling ? "Enrolling…" : "Enroll"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
