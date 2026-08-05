"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { Label } from "../atoms/label";
import { Textarea } from "../atoms/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";

interface TermOption {
  id: string;
  name: string;
}
interface StudentItem {
  id: string;
  admissionNumber: string;
  user: { firstName: string; lastName: string };
}
interface CommentRecord {
  studentId: string;
  commentType: string;
  comment: string;
}

export function PrincipalCommentPanel({ terms }: { terms: TermOption[] }) {
  const [students, setStudents] = useState<StudentItem[]>([]);
  const [studentId, setStudentId] = useState("");
  const [termId, setTermId] = useState("");
  const [comment, setComment] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<StudentItem[]>("/students", { auth: true })
      .then(setStudents)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load students"));
  }, []);

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
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save comment");
      setSaveState("error");
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="pc-student">Student</Label>
          <Select value={studentId} onValueChange={setStudentId}>
            <SelectTrigger id="pc-student" className="mt-1">
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

      {(!studentId || !termId) && <p className="text-sm text-muted">Select a student and term to begin.</p>}
    </div>
  );
}
