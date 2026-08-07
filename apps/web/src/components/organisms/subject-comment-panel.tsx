"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { usePaginatedStudents } from "../../lib/use-paginated-students";
import { Button } from "../atoms/button";
import { Label } from "../atoms/label";
import { Textarea } from "../atoms/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";
import { SearchableSelect } from "../molecules/searchable-select";
import { PaginatedStudentList } from "./paginated-student-list";

interface ClassArmOption {
  id: string;
  name: string;
  displayName: string;
  classLevel: { category: string };
}
interface SubjectOption {
  id: string;
  name: string;
  isGroup: boolean;
  childSubjects?: { id: string; name: string }[];
}
interface StaffAssignmentItem {
  assignmentType: string;
  classArmId: string | null;
  subjectId: string | null;
  isActive: boolean;
}
interface TermOption {
  id: string;
  name: string;
}
interface CommentRecord {
  studentId: string;
  commentType: string;
  subjectId: string | null;
  comment: string;
}
interface ProgressSummary {
  totalStudents: number;
  completedCount: number;
}

export function SubjectCommentPanel({
  classArmOptions,
  terms,
  isAdmin,
  mySubjectTeacherAssignments,
}: {
  classArmOptions: ClassArmOption[];
  terms: TermOption[];
  isAdmin: boolean;
  mySubjectTeacherAssignments: StaffAssignmentItem[];
}) {
  const [classArmId, setClassArmId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [termId, setTermId] = useState("");
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [comments, setComments] = useState<CommentRecord[]>([]);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<Record<string, "saving" | "saved" | "error">>({});
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressSummary | null>(null);

  const {
    students,
    total,
    loading: studentsLoading,
    error: studentsError,
    hasMore,
    search,
    setSearch,
    loadMore,
  } = usePaginatedStudents({ classArmId });

  const selectedArm = classArmOptions.find((a) => a.id === classArmId) ?? null;

  // Subjects are scoped to the selected class arm's class group (Primary,
  // JSS, …) via the ClassSubject join table — not the whole catalogue — so
  // resolving them waits on a class arm being picked.
  useEffect(() => {
    setSubjectId("");
    if (!selectedArm) {
      setSubjects([]);
      return;
    }
    apiFetch<SubjectOption[]>(`/subjects?classLevelCategory=${selectedArm.classLevel.category}`, { auth: true })
      .then(setSubjects)
      .catch(() => setSubjects([]));
  }, [selectedArm]);

  // A "group" subject is never itself scored/commented on — only its
  // children are (see gradebook page.tsx's identical flattening).
  const selectableSubjects = subjects.flatMap((subject) =>
    subject.isGroup && subject.childSubjects && subject.childSubjects.length > 0
      ? subject.childSubjects.map((child) => ({ id: child.id, name: `${child.name} (${subject.name})` }))
      : [{ id: subject.id, name: subject.name }],
  );
  const subjectOptions = isAdmin
    ? selectableSubjects
    : selectableSubjects.filter((subject) =>
        mySubjectTeacherAssignments.some((a) => a.classArmId === classArmId && a.subjectId === subject.id),
      );

  const loadComments = useCallback(() => {
    if (!classArmId || !subjectId || !termId) return;
    setError(null);
    apiFetch<CommentRecord[]>(`/report-comments?termId=${termId}`, { auth: true })
      .then(setComments)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load subject comments"));
  }, [classArmId, subjectId, termId]);

  const loadProgress = useCallback(() => {
    if (!classArmId || !subjectId || !termId) {
      setProgress(null);
      return;
    }
    apiFetch<ProgressSummary>(
      `/report-comments/progress?classArmId=${classArmId}&termId=${termId}&commentType=SUBJECT&subjectId=${subjectId}`,
      { auth: true },
    )
      .then(setProgress)
      .catch(() => setProgress(null));
  }, [classArmId, subjectId, termId]);

  useEffect(() => {
    setCommentDrafts({});
    setSaveState({});
    loadComments();
    loadProgress();
  }, [loadComments, loadProgress]);

  // Seeds drafts for any newly-appended (scrolled-in or re-searched) student
  // without touching drafts already held for students already on screen —
  // an in-progress edit must survive "load more" firing on scroll.
  useEffect(() => {
    setCommentDrafts((prev) => {
      const additions = students.filter((s) => !(s.id in prev));
      if (additions.length === 0) return prev;
      const next = { ...prev };
      for (const student of additions) {
        const match = comments.find(
          (c) => c.studentId === student.id && c.commentType === "SUBJECT" && c.subjectId === subjectId,
        );
        next[student.id] = match?.comment ?? "";
      }
      return next;
    });
  }, [students, comments, subjectId]);

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
      loadProgress();
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
                  {arm.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="sc-subject">Subject</Label>
          <SearchableSelect
            id="sc-subject"
            value={subjectId}
            onValueChange={setSubjectId}
            options={subjectOptions.map((s) => ({ value: s.id, label: s.name }))}
            placeholder={classArmId ? "Select subject" : "Select a class arm first"}
            className="mt-1"
          />
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

      {classArmId && subjectId && termId && progress && (
        <p className="text-[12.5px] text-muted">
          Subject comments: {progress.completedCount}/{progress.totalStudents}
        </p>
      )}

      {classArmId && subjectId && termId ? (
        <PaginatedStudentList
          studentCount={students.length}
          total={total}
          loading={studentsLoading}
          error={studentsError}
          hasMore={hasMore}
          search={search}
          onSearchChange={setSearch}
          onLoadMore={loadMore}
          className="max-h-none space-y-3"
        >
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
        </PaginatedStudentList>
      ) : (
        <p className="text-sm text-muted">Select a class arm, subject, and term to begin.</p>
      )}
    </div>
  );
}
