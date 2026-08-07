"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { Label } from "../atoms/label";
import { Textarea } from "../atoms/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";
import { StudentCombobox } from "../molecules/student-combobox";

interface ClassArmOption {
  id: string;
  name: string;
}
interface TermOption {
  id: string;
  name: string;
}
interface CommentRecord {
  studentId: string;
  commentType: string;
  comment: string;
}
interface ProgressSummary {
  totalStudents: number;
  completedCount: number;
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

  useEffect(() => {
    setStudentId("");
  }, [classArmId]);

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
                  {arm.name}
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
