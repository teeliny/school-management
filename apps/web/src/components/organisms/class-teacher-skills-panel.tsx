"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { usePaginatedStudents } from "../../lib/use-paginated-students";
import { Button } from "../atoms/button";
import { Label } from "../atoms/label";
import { Badge, type BadgeVariant } from "../atoms/badge";
import { Textarea } from "../atoms/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";
import { PaginatedStudentList } from "./paginated-student-list";

interface ClassArmOption {
  id: string;
  name: string;
  displayName: string;
  classLevel: { category: string };
}
interface TermOption {
  id: string;
  name: string;
  academicSessionId: string;
}
type SkillCategory = "PSYCHOMOTOR" | "AFFECTIVE_COGNITIVE";
interface SkillItem {
  id: string;
  category: SkillCategory;
  name: string;
  order: number;
}
type RatingValue = "EXCELLENT" | "VERY_GOOD" | "GOOD" | "FAIR" | "POOR";
interface RatingRecord {
  studentId: string;
  skillAssessmentItemId: string;
  rating: RatingValue;
}
interface CommentRecord {
  studentId: string;
  commentType: string;
  comment: string;
}
type ReportWindowStatus = "DRAFT" | "OPEN" | "CLOSED";
interface ProgressSummary {
  totalStudents: number;
  completedCount: number;
}

const RATINGS: RatingValue[] = ["EXCELLENT", "VERY_GOOD", "GOOD", "FAIR", "POOR"];
const CATEGORY_LABEL: Record<SkillCategory, string> = {
  PSYCHOMOTOR: "Psychomotor",
  AFFECTIVE_COGNITIVE: "Affective / Cognitive",
};
const WINDOW_VARIANT: Record<ReportWindowStatus, BadgeVariant> = {
  DRAFT: "muted",
  OPEN: "success",
  CLOSED: "warning",
};

export function ClassTeacherSkillsPanel({
  classArmOptions,
  terms,
  isAdmin,
}: {
  classArmOptions: ClassArmOption[];
  terms: TermOption[];
  isAdmin: boolean;
}) {
  const [classArmId, setClassArmId] = useState("");
  const [termId, setTermId] = useState("");
  const [windowStatus, setWindowStatus] = useState<ReportWindowStatus | null>(null);
  const [skillItems, setSkillItems] = useState<SkillItem[]>([]);
  const [ratings, setRatings] = useState<RatingRecord[]>([]);
  const [comments, setComments] = useState<CommentRecord[]>([]);
  const [ratingDrafts, setRatingDrafts] = useState<Record<string, Record<string, RatingValue | "">>>({});
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<Record<string, "saving" | "saved" | "error">>({});
  const [error, setError] = useState<string | null>(null);
  const [commentProgress, setCommentProgress] = useState<ProgressSummary | null>(null);
  const [ratingProgress, setRatingProgress] = useState<ProgressSummary | null>(null);

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
  const selectedTerm = terms.find((t) => t.id === termId) ?? null;

  // Rating/comment context for the whole term+class group — independent of
  // which page of the (searched, paginated) roster is currently visible.
  const load = useCallback(() => {
    if (!classArmId || !termId || !selectedArm || !selectedTerm) return;
    setError(null);
    Promise.all([
      apiFetch<{ status: ReportWindowStatus }[]>(
        `/report-windows?termId=${termId}&classLevelCategory=${selectedArm.classLevel.category}`,
        { auth: true },
      ),
      apiFetch<SkillItem[]>(`/skill-assessment-items?academicSessionId=${selectedTerm.academicSessionId}`, {
        auth: true,
      }),
      apiFetch<RatingRecord[]>(`/skill-ratings?termId=${termId}`, { auth: true }),
      apiFetch<CommentRecord[]>(`/report-comments?termId=${termId}`, { auth: true }),
      apiFetch<ProgressSummary>(
        `/report-comments/progress?classArmId=${classArmId}&termId=${termId}&commentType=CLASS_TEACHER`,
        { auth: true },
      ),
      apiFetch<ProgressSummary>(
        `/skill-ratings/progress?classArmId=${classArmId}&termId=${termId}&academicSessionId=${selectedTerm.academicSessionId}`,
        { auth: true },
      ),
    ])
      .then(([windows, items, nextRatings, nextComments, commentSummary, ratingSummary]) => {
        setWindowStatus(windows[0]?.status ?? null);
        setSkillItems(items);
        setRatings(nextRatings);
        setComments(nextComments);
        setCommentProgress(commentSummary);
        setRatingProgress(ratingSummary);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load skills & comments"));
  }, [classArmId, termId, selectedArm, selectedTerm]);

  useEffect(() => {
    setRatingDrafts({});
    setCommentDrafts({});
    setSaveState({});
    load();
  }, [load]);

  // Seeds drafts for any newly-appended (scrolled-in or re-searched) student
  // without touching drafts already held for students already on screen —
  // an in-progress edit must survive "load more" firing on scroll.
  useEffect(() => {
    setRatingDrafts((prev) => {
      const additions = students.filter((s) => !(s.id in prev));
      if (additions.length === 0) return prev;
      return { ...prev, ...buildRatingDrafts(additions, skillItems, ratings) };
    });
    setCommentDrafts((prev) => {
      const additions = students.filter((s) => !(s.id in prev));
      if (additions.length === 0) return prev;
      return { ...prev, ...buildCommentDrafts(additions, comments) };
    });
  }, [students, skillItems, ratings, comments]);

  const itemsByCategory = useMemo(() => {
    const grouped: Record<SkillCategory, SkillItem[]> = { PSYCHOMOTOR: [], AFFECTIVE_COGNITIVE: [] };
    for (const item of skillItems) grouped[item.category].push(item);
    for (const category of Object.keys(grouped) as SkillCategory[]) {
      grouped[category].sort((a, b) => a.order - b.order);
    }
    return grouped;
  }, [skillItems]);

  const readOnly = !isAdmin && windowStatus !== "OPEN";

  function refreshProgress() {
    if (!classArmId || !termId || !selectedTerm) return;
    apiFetch<ProgressSummary>(
      `/report-comments/progress?classArmId=${classArmId}&termId=${termId}&commentType=CLASS_TEACHER`,
      { auth: true },
    )
      .then(setCommentProgress)
      .catch(() => undefined);
    apiFetch<ProgressSummary>(
      `/skill-ratings/progress?classArmId=${classArmId}&termId=${termId}&academicSessionId=${selectedTerm.academicSessionId}`,
      { auth: true },
    )
      .then(setRatingProgress)
      .catch(() => undefined);
  }

  async function saveStudent(studentId: string) {
    setSaveState((s) => ({ ...s, [studentId]: "saving" }));
    try {
      const ratingCalls = Object.entries(ratingDrafts[studentId] ?? {})
        .filter(([, rating]) => rating !== "")
        .map(([skillAssessmentItemId, rating]) =>
          apiFetch("/skill-ratings", {
            method: "POST",
            auth: true,
            body: { studentId, termId, skillAssessmentItemId, rating },
          }),
        );
      const comment = commentDrafts[studentId] ?? "";
      const commentCall = comment.trim()
        ? [
            apiFetch("/report-comments", {
              method: "POST",
              auth: true,
              body: { studentId, termId, commentType: "CLASS_TEACHER", comment },
            }),
          ]
        : [];
      await Promise.all([...ratingCalls, ...commentCall]);
      setSaveState((s) => ({ ...s, [studentId]: "saved" }));
      refreshProgress();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
      setSaveState((s) => ({ ...s, [studentId]: "error" }));
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="cts-class-arm">Class arm</Label>
          <Select value={classArmId} onValueChange={setClassArmId}>
            <SelectTrigger id="cts-class-arm" className="mt-1">
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
          <Label htmlFor="cts-term">Term</Label>
          <Select value={termId} onValueChange={setTermId}>
            <SelectTrigger id="cts-term" className="mt-1">
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

      {classArmId && termId && (
        <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-muted">
          <span className="flex items-center gap-2">
            Report window:
            {windowStatus ? (
              <Badge variant={WINDOW_VARIANT[windowStatus]}>{windowStatus}</Badge>
            ) : (
              <Badge variant="muted">NOT CONFIGURED</Badge>
            )}
          </span>
          {commentProgress && (
            <span>
              Class-teacher comments: {commentProgress.completedCount}/{commentProgress.totalStudents}
            </span>
          )}
          {ratingProgress && (
            <span>
              Skill ratings: {ratingProgress.completedCount}/{ratingProgress.totalStudents}
            </span>
          )}
          {readOnly && <span className="text-warning">— entry closed until the window is OPEN</span>}
        </div>
      )}

      {classArmId && termId ? (
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
                  <Button type="button" size="sm" disabled={readOnly} onClick={() => saveStudent(student.id)}>
                    Save
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {(Object.keys(itemsByCategory) as SkillCategory[]).map((category) =>
                  itemsByCategory[category].length > 0 ? (
                    <div key={category}>
                      <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                        {CATEGORY_LABEL[category]}
                      </p>
                      <div className="space-y-1.5">
                        {itemsByCategory[category].map((item) => (
                          <div key={item.id} className="flex items-center justify-between gap-2">
                            <span className="text-[12px] text-foreground">{item.name}</span>
                            <Select
                              value={ratingDrafts[student.id]?.[item.id] ?? ""}
                              onValueChange={(v) =>
                                setRatingDrafts((s) => ({
                                  ...s,
                                  [student.id]: { ...s[student.id], [item.id]: v as RatingValue },
                                }))
                              }
                              disabled={readOnly}
                            >
                              <SelectTrigger className="h-8 w-36 text-[11.5px]">
                                <SelectValue placeholder="Rate…" />
                              </SelectTrigger>
                              <SelectContent>
                                {RATINGS.map((r) => (
                                  <SelectItem key={r} value={r}>
                                    {r.replace("_", " ")}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null,
                )}
              </div>

              {skillItems.length === 0 && (
                <p className="text-[12px] text-muted">No skill assessment items configured for this session yet.</p>
              )}

              <div className="mt-3">
                <Label htmlFor={`cts-comment-${student.id}`}>Class-teacher comment</Label>
                <Textarea
                  id={`cts-comment-${student.id}`}
                  className="mt-1"
                  rows={2}
                  disabled={readOnly}
                  value={commentDrafts[student.id] ?? ""}
                  onChange={(e) => setCommentDrafts((s) => ({ ...s, [student.id]: e.target.value }))}
                />
              </div>
            </div>
          ))}
        </PaginatedStudentList>
      ) : (
        <p className="text-sm text-muted">Select a class arm and term to begin.</p>
      )}
    </div>
  );
}

function buildRatingDrafts(students: { id: string }[], items: SkillItem[], ratings: RatingRecord[]) {
  const drafts: Record<string, Record<string, RatingValue | "">> = {};
  for (const student of students) {
    const studentDrafts: Record<string, RatingValue | ""> = {};
    for (const item of items) {
      const match = ratings.find((r) => r.studentId === student.id && r.skillAssessmentItemId === item.id);
      studentDrafts[item.id] = match?.rating ?? "";
    }
    drafts[student.id] = studentDrafts;
  }
  return drafts;
}
function buildCommentDrafts(students: { id: string }[], comments: CommentRecord[]) {
  const drafts: Record<string, string> = {};
  for (const student of students) {
    const match = comments.find((c) => c.studentId === student.id && c.commentType === "CLASS_TEACHER");
    drafts[student.id] = match?.comment ?? "";
  }
  return drafts;
}
