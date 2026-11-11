"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { Label } from "../atoms/label";
import { Badge, type BadgeVariant } from "../atoms/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";
import { MultiSelect } from "../molecules/multi-select";
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
  // Dropped from a COMPULSORY subject — a per-student exemption the
  // compulsory auto-enroll won't undo (StudentSubjectExemption).
  exempt: boolean;
  subject: { name: string; code: string };
}
interface DropResult {
  exempted: boolean;
  reportCardsFlagged: number;
}
interface RestoreResult {
  reportCardsFlagged: number;
}
interface DepartmentOption {
  department: { name: string };
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
//
// Drop works on any ACTIVE row; dropping a COMPULSORY subject records a
// per-student exemption so it stays dropped. Restore reverses either kind.
// Both flag the term's already-generated report cards for regeneration.
export function StudentSubjectEnrollmentManager() {
  const [classArms, setClassArms] = useState<ClassArmOption[]>([]);
  const [classArmId, setClassArmId] = useState("");
  const [terms, setTerms] = useState<TermOption[]>([]);
  const [termId, setTermId] = useState("");
  const [classSubjects, setClassSubjects] = useState<ClassSubjectOption[]>([]);
  const [studentId, setStudentId] = useState("");
  const [enrollments, setEnrollments] = useState<EnrollmentRow[] | null>(null);
  const [department, setDepartment] = useState<{ name: string } | null>(null);
  const [subjectsToEnroll, setSubjectsToEnroll] = useState<string[]>([]);
  const [enrolling, setEnrolling] = useState(false);
  const [droppingId, setDroppingId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
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
    setSubjectsToEnroll([]);
    setEnrollments(null);
  }, [classArmId]);

  // Department gates which DEPARTMENT-type subjects a student can opt into
  // (enroll() rejects a mismatch) — shown upfront rather than only
  // surfacing as an enroll-time error. Only meaningful for SSS, same
  // scoping StudentDepartmentService.create enforces.
  useEffect(() => {
    if (!studentId || selectedClassArm?.classLevel.category !== "SSS") {
      setDepartment(null);
      return;
    }
    apiFetch<DepartmentOption[]>(
      `/student-departments?studentId=${studentId}&academicSessionId=${selectedClassArm.academicSessionId}`,
      { auth: true },
    )
      .then((rows) => setDepartment(rows[0]?.department ?? null))
      .catch(() => setDepartment(null));
  }, [studentId, selectedClassArm]);

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
    if (!selectedClassArm || subjectsToEnroll.length === 0) return;
    setError(null);
    setSuccess(null);
    setEnrolling(true);
    try {
      const result = await apiFetch<{ enrolled: string[]; failed: { subjectId: string; error: string }[] }>(
        "/student-subject-enrollments/bulk",
        {
          method: "POST",
          auth: true,
          body: {
            studentId,
            subjectIds: subjectsToEnroll,
            classArmId,
            academicSessionId: selectedClassArm.academicSessionId,
            termId,
          },
        },
      );
      setSubjectsToEnroll([]);
      if (result.failed.length === 0) {
        setSuccess(`Enrolled in ${result.enrolled.length} subject${result.enrolled.length === 1 ? "" : "s"}.`);
      } else {
        const failedNames = result.failed.map((f) => {
          const subject = classSubjects.find((cs) => cs.subjectId === f.subjectId)?.subject;
          return `${subject ? `${subject.name} (${subject.code})` : f.subjectId}: ${f.error}`;
        });
        setSuccess(result.enrolled.length > 0 ? `Enrolled in ${result.enrolled.length} subject(s).` : null);
        setError(`Failed to enroll in ${result.failed.length} subject(s) — ${failedNames.join("; ")}`);
      }
      loadEnrollments();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to enroll student");
    } finally {
      setEnrolling(false);
    }
  }

  function reportNote(count: number): string {
    if (count === 0) return "";
    return ` ${count} existing report card${count === 1 ? " is" : "s are"} now marked for regeneration.`;
  }

  async function drop(row: EnrollmentRow) {
    setError(null);
    setSuccess(null);
    setDroppingId(row.id);
    try {
      const result = await apiFetch<DropResult>(`/student-subject-enrollments/${row.id}/drop`, {
        method: "PATCH",
        auth: true,
      });
      setSuccess(
        `Dropped ${row.subject.name}.` +
          (result.exempted ? " It's compulsory, so the student is now exempt and it won't be re-added automatically." : "") +
          reportNote(result.reportCardsFlagged),
      );
      loadEnrollments();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to drop subject enrollment");
    } finally {
      setDroppingId(null);
    }
  }

  async function restore(row: EnrollmentRow) {
    setError(null);
    setSuccess(null);
    setRestoringId(row.id);
    try {
      const result = await apiFetch<RestoreResult>(`/student-subject-enrollments/${row.id}/restore`, {
        method: "PATCH",
        auth: true,
      });
      setSuccess(`Restored ${row.subject.name}.` + reportNote(result.reportCardsFlagged));
      loadEnrollments();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to restore subject enrollment");
    } finally {
      setRestoringId(null);
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
          {selectedClassArm?.classLevel.category === "SSS" && (
            <p className="text-sm text-muted">
              Department: <span className="font-medium text-foreground">{department?.name ?? "Not assigned"}</span>
            </p>
          )}

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
                  <tr key={row.id} className="border-b border-border/60 last:border-none even:bg-card-inset">
                    <td className="py-2.5 pr-4">
                      {row.subject.name} <span className="font-mono text-muted">({row.subject.code})</span>
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className="inline-flex flex-wrap gap-1.5">
                        <Badge variant={STATUS_VARIANT[row.status]}>{row.status}</Badge>
                        {row.exempt && <Badge variant="warning">EXEMPT</Badge>}
                      </span>
                    </td>
                    <td className="py-2.5">
                      {row.status === "ACTIVE" ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={droppingId === row.id}
                          onClick={() => drop(row)}
                        >
                          {droppingId === row.id ? "Dropping…" : "Drop"}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={restoringId === row.id}
                          onClick={() => restore(row)}
                        >
                          {restoringId === row.id ? "Restoring…" : "Restore"}
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
            <div className="min-w-0 flex-1">
              <Label htmlFor="sse-add-subject">Opt into subjects</Label>
              <MultiSelect
                id="sse-add-subject"
                value={subjectsToEnroll}
                onValueChange={setSubjectsToEnroll}
                options={eligibleSubjects.map((cs) => ({
                  value: cs.subjectId,
                  label: `${cs.subject.name} (${cs.subject.code}) — ${TYPE_LABELS[cs.type]}`,
                }))}
                placeholder="Select subjects"
                className="mt-1"
              />
            </div>
            <Button type="button" disabled={subjectsToEnroll.length === 0 || enrolling} onClick={enroll}>
              {enrolling ? "Enrolling…" : "Enroll"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
