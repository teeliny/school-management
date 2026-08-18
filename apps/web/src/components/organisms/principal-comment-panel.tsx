"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { Label } from "../atoms/label";
import { Textarea } from "../atoms/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";
import { StudentCombobox } from "../molecules/student-combobox";

interface ClassArmOption {
  id: string;
  name: string;
  displayName: string;
}
interface TermOption {
  id: string;
  name: string;
  academicSessionId: string;
}
interface CommentRecord {
  studentId: string;
  commentType: string;
  comment: string;
}
interface EnrollmentRecord {
  subjectId: string;
  status: string;
}
interface ProgressSummary {
  totalStudents: number;
  completedCount: number;
}
interface BroadsheetSubjectCell {
  subjectId: string;
  totalScore: number | null;
  grade: string | null;
  position: number | null;
}
interface BroadsheetRow {
  studentId: string;
  subjects: BroadsheetSubjectCell[];
  overallAverage: number | null;
  overallGrade: string | null;
  overallPosition: number | null;
}
interface BroadsheetResponse {
  subjectColumns: { id: string; name: string }[];
  rows: BroadsheetRow[];
}

// PRINCIPAL/HEADTEACHER authorization is school-wide (see
// ReportCommentService.write's principal branch — no class-arm check at
// all), so `classArmOptions` here is the full, unfiltered class-arm list;
// the dropdown only narrows which students show up in the picker below.
export function PrincipalCommentPanel({
  classArmOptions,
  terms,
}: {
  classArmOptions: ClassArmOption[];
  terms: TermOption[];
}) {
  const [classArmId, setClassArmId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [termId, setTermId] = useState("");
  const [comment, setComment] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressSummary | null>(null);
  const [broadsheet, setBroadsheet] = useState<BroadsheetResponse | null>(null);
  const [scoresLoading, setScoresLoading] = useState(false);
  const [scoresError, setScoresError] = useState<string | null>(null);

  useEffect(() => {
    setStudentId("");
  }, [classArmId]);

  // Same source the report card itself draws from (SubjectTermResult, via
  // BroadsheetService) — fetched once per class-arm/term (not per student,
  // Broadsheet is already a whole-arm grid) so the Principal/Headteacher can
  // see exactly what the student's report will show while writing the
  // comment, instead of writing blind.
  useEffect(() => {
    if (!classArmId || !termId) {
      setBroadsheet(null);
      return;
    }
    setScoresLoading(true);
    setScoresError(null);
    apiFetch<BroadsheetResponse>(`/broadsheet?classArmId=${classArmId}&termId=${termId}`, { auth: true })
      .then(setBroadsheet)
      .catch((err) => {
        setBroadsheet(null);
        setScoresError(err instanceof ApiError ? err.message : "Failed to load scores");
      })
      .finally(() => setScoresLoading(false));
  }, [classArmId, termId]);

  const scoreRow = useMemo(
    () => broadsheet?.rows.find((row) => row.studentId === studentId) ?? null,
    [broadsheet, studentId],
  );
  const subjectColumns = broadsheet?.subjectColumns ?? [];

  // Broadsheet's subjectColumns is every subject catalogued for the whole
  // class group (PRD §3.3 ClassSubject), not this one student's actual
  // enrollment — narrowed here so the Principal isn't shown subjects (e.g. a
  // Science student's row still carrying Commerce/Literature columns) the
  // student never opted into.
  const [enrolledSubjectIds, setEnrolledSubjectIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    const term = terms.find((t) => t.id === termId);
    if (!studentId || !termId || !term) {
      setEnrolledSubjectIds(new Set());
      return;
    }
    apiFetch<EnrollmentRecord[]>(
      `/student-subject-enrollments?studentId=${studentId}&academicSessionId=${term.academicSessionId}&termId=${termId}`,
      { auth: true },
    )
      .then((enrollments) => {
        setEnrolledSubjectIds(new Set(enrollments.filter((e) => e.status === "ACTIVE").map((e) => e.subjectId)));
      })
      .catch(() => setEnrolledSubjectIds(new Set()));
  }, [studentId, termId, terms]);

  const visibleSubjects = useMemo(
    () =>
      subjectColumns
        .map((subject, i) => ({ subject, cell: scoreRow?.subjects[i] }))
        .filter(({ subject }) => enrolledSubjectIds.has(subject.id)),
    [subjectColumns, scoreRow, enrolledSubjectIds],
  );

  const load = useCallback(() => {
    if (!studentId || !termId) {
      setComment("");
      return;
    }
    apiFetch<CommentRecord[]>(`/report-comments?studentId=${studentId}&termId=${termId}`, { auth: true })
      .then((comments) => {
        const match = comments.find((c) => c.commentType === "PRINCIPAL");
        setComment(match?.comment ?? "");
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load comment"));
  }, [studentId, termId]);

  useEffect(() => {
    load();
  }, [load]);

  const loadProgress = useCallback(() => {
    if (!classArmId || !termId) {
      setProgress(null);
      return;
    }
    apiFetch<ProgressSummary>(
      `/report-comments/progress?classArmId=${classArmId}&termId=${termId}&commentType=PRINCIPAL`,
      { auth: true },
    )
      .then(setProgress)
      .catch(() => setProgress(null));
  }, [classArmId, termId]);

  useEffect(() => {
    loadProgress();
  }, [loadProgress]);

  async function save() {
    if (!comment.trim()) return;
    setSaveState("saving");
    setError(null);
    try {
      await apiFetch("/report-comments", {
        method: "POST",
        auth: true,
        body: { studentId, termId, commentType: "PRINCIPAL", comment },
      });
      setSaveState("saved");
      loadProgress();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save comment");
      setSaveState("error");
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="pc-class-arm">Class arm</Label>
          <Select value={classArmId} onValueChange={setClassArmId}>
            <SelectTrigger id="pc-class-arm" className="mt-1">
              <SelectValue placeholder="Select class" />
            </SelectTrigger>
            <SelectContent>
              {classArmOptions.map((arm) => (
                <SelectItem key={arm.id} value={arm.id}>
                  {arm.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="pc-student">Student</Label>
          <StudentCombobox
            id="pc-student"
            classArmId={classArmId}
            value={studentId}
            onValueChange={(id) => setStudentId(id)}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="pc-term">Term</Label>
          <Select value={termId} onValueChange={setTermId}>
            <SelectTrigger id="pc-term" className="mt-1">
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

      {classArmId && termId && progress && (
        <p className="text-[12.5px] text-muted">
          Principal comments: {progress.completedCount}/{progress.totalStudents}
        </p>
      )}

      {studentId && termId && (
        <div className="rounded-md border border-border bg-card-inset p-3">
          {scoresLoading && <p className="text-[12.5px] text-muted">Loading scores…</p>}
          {!scoresLoading && scoresError && <p className="text-[12.5px] text-danger">{scoresError}</p>}
          {!scoresLoading && !scoresError && broadsheet && !scoreRow && (
            <p className="text-[12.5px] text-muted">No scores recorded for this student this term yet.</p>
          )}
          {!scoresLoading && !scoresError && scoreRow && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr className="border-b border-border text-muted">
                    <th className="py-1.5 pr-4 font-medium">Subject</th>
                    <th className="py-1.5 pr-4 font-medium">Score</th>
                    <th className="py-1.5 font-medium">Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSubjects.map(({ subject, cell }) => (
                    <tr key={subject.id} className="border-b border-border/60 last:border-none">
                      <td className="py-1.5 pr-4">{subject.name}</td>
                      <td className="py-1.5 pr-4 font-mono">
                        {cell?.totalScore == null ? <span className="text-muted">—</span> : cell.totalScore.toFixed(2)}
                      </td>
                      <td className="py-1.5 font-mono">{cell?.grade ?? <span className="text-muted">—</span>}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="pt-1.5 pr-4 font-medium">Overall</td>
                    <td className="pt-1.5 pr-4 font-mono font-medium">
                      {scoreRow.overallAverage == null ? (
                        <span className="text-muted">—</span>
                      ) : (
                        scoreRow.overallAverage.toFixed(2)
                      )}
                    </td>
                    <td className="pt-1.5 font-mono font-medium">
                      {scoreRow.overallGrade ?? <span className="text-muted">—</span>}
                      {scoreRow.overallPosition != null && (
                        <span className="ml-2 font-sans text-muted">(Position {scoreRow.overallPosition})</span>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {studentId && termId && (
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor="pc-comment" className="mb-0">
              Principal / Headteacher comment
            </Label>
            <div className="flex items-center gap-2">
              {saveState === "saving" && <span className="text-[11px] text-muted">Saving…</span>}
              {saveState === "saved" && <span className="text-[11px] text-success">Saved</span>}
              {saveState === "error" && <span className="text-[11px] text-danger">Failed</span>}
              <Button type="button" size="sm" onClick={save}>
                Save
              </Button>
            </div>
          </div>
          <Textarea id="pc-comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>
      )}

      {(!studentId || !termId) && <p className="text-sm text-muted">Select a class arm, student, and term to begin.</p>}
    </div>
  );
}
