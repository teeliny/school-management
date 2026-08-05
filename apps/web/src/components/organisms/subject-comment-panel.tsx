"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { Label } from "../atoms/label";
import { Textarea } from "../atoms/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";

interface ClassArmOption {
  id: string;
  name: string;
}
interface SubjectOption {
  id: string;
  name: string;
}
interface TermOption {
  id: string;
  name: string;
}
interface StudentItem {
  id: string;
  admissionNumber: string;
  currentClassId: string | null;
  user: { firstName: string; lastName: string };
}
interface CommentRecord {
  studentId: string;
  commentType: string;
  subjectId: string | null;
  comment: string;
}

export function SubjectCommentPanel({
  classArmOptions,
  subjectOptions,
  terms,
}: {
  classArmOptions: ClassArmOption[];
  subjectOptions: SubjectOption[];
  terms: TermOption[];
}) {
  const [classArmId, setClassArmId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [termId, setTermId] = useState("");
  const [students, setStudents] = useState<StudentItem[] | null>(null);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<Record<string, "saving" | "saved" | "error">>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!classArmId || !subjectId || !termId) {
      setStudents(null);
      return;
    }
    setError(null);
    Promise.all([
      apiFetch<StudentItem[]>("/students", { auth: true }),
      apiFetch<CommentRecord[]>(`/report-comments?termId=${termId}`, { auth: true }),
    ])
      .then(([allStudents, comments]) => {
        const classStudents = allStudents.filter((s) => s.currentClassId === classArmId);
        setStudents(classStudents);
        const nextDrafts: Record<string, string> = {};
        for (const student of classStudents) {
          const match = comments.find(
            (c) => c.studentId === student.id && c.commentType === "SUBJECT" && c.subjectId === subjectId,
          );
          nextDrafts[student.id] = match?.comment ?? "";
        }
        setCommentDrafts(nextDrafts);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load subject comments"));
  }, [classArmId, subjectId, termId]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveStudent(studentId: string) {
    const comment = commentDrafts[studentId] ?? "";
    if (!comment.trim()) return;
    setSaveState((s) => ({ ...s, [studentId]: "saving" }));
    try {
      await apiFetch("/report-comments", {
        method: "POST",
        auth: true,
        body: { studentId, termId, commentType: "SUBJECT", subjectId, comment },
      });
      setSaveState((s) => ({ ...s, [studentId]: "saved" }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save comment");
      setSaveState((s) => ({ ...s, [studentId]: "error" }));
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="sc-class-arm">Class arm</Label>
          <Select value={classArmId} onValueChange={setClassArmId}>
            <SelectTrigger id="sc-class-arm" className="mt-1">
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
          <Label htmlFor="sc-subject">Subject</Label>
          <Select value={subjectId} onValueChange={setSubjectId}>
            <SelectTrigger id="sc-subject" className="mt-1">
              <SelectValue placeholder="Select subject" />
            </SelectTrigger>
            <SelectContent>
              {subjectOptions.map((subject) => (
                <SelectItem key={subject.id} value={subject.id}>
                  {subject.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="sc-term">Term</Label>
          <Select value={termId} onValueChange={setTermId}>
            <SelectTrigger id="sc-term" className="mt-1">
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

      {!students && classArmId && subjectId && termId && <p className="text-sm text-muted">Loading…</p>}
      {students && students.length === 0 && <p className="text-sm text-muted">No students in this class arm.</p>}

      {students && students.length > 0 && (
        <div className="space-y-3">
          {students.map((student) => (
            <div key={student.id} className="rounded-lg border border-border p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13px] font-medium">
                  {student.user.firstName} {student.user.lastName}{" "}
                  <span className="font-mono text-muted">({student.admissionNumber})</span>
                </p>
                <div className="flex items-center gap-2">
                  {saveState[student.id] === "saving" && <span className="text-[11px] text-muted">Saving…</span>}
                  {saveState[student.id] === "saved" && <span className="text-[11px] text-success">Saved</span>}
                  {saveState[student.id] === "error" && <span className="text-[11px] text-danger">Failed</span>}
                  <Button type="button" size="sm" onClick={() => saveStudent(student.id)}>
                    Save
                  </Button>
                </div>
              </div>
              <Textarea
                rows={2}
                value={commentDrafts[student.id] ?? ""}
                onChange={(e) => setCommentDrafts((s) => ({ ...s, [student.id]: e.target.value }))}
              />
            </div>
          ))}
        </div>
      )}

      {(!classArmId || !subjectId || !termId) && (
        <p className="text-sm text-muted">Select a class arm, subject, and term to begin.</p>
      )}
    </div>
  );
}
