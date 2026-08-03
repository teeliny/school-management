"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { Label } from "../atoms/label";
import { Badge, type BadgeVariant } from "../atoms/badge";
import { Textarea } from "../atoms/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";

interface ClassArmOption {
  id: string;
  name: string;
  classLevelId: string;
}
interface TermOption {
  id: string;
  name: string;
  academicSessionId: string;
}
interface StudentItem {
  id: string;
  admissionNumber: string;
  currentClassId: string | null;
  user: { firstName: string; lastName: string };
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
  const [students, setStudents] = useState<StudentItem[] | null>(null);
  const [skillItems, setSkillItems] = useState<SkillItem[]>([]);
  const [ratingDrafts, setRatingDrafts] = useState<Record<string, Record<string, RatingValue | "">>>({});
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<Record<string, "saving" | "saved" | "error">>({});
  const [error, setError] = useState<string | null>(null);

  const selectedArm = classArmOptions.find((a) => a.id === classArmId) ?? null;
  const selectedTerm = terms.find((t) => t.id === termId) ?? null;

  const load = useCallback(() => {
    if (!classArmId || !termId || !selectedArm || !selectedTerm) {
      setStudents(null);
      return;
    }
    setError(null);
    Promise.all([
      apiFetch<StudentItem[]>("/students", { auth: true }),
      apiFetch<{ status: ReportWindowStatus }[]>(
        `/report-windows?termId=${termId}&classLevelId=${selectedArm.classLevelId}`,
        { auth: true },
      ),
      apiFetch<SkillItem[]>(`/skill-assessment-items?academicSessionId=${selectedTerm.academicSessionId}`, {
        auth: true,
      }),
      apiFetch<RatingRecord[]>(`/skill-ratings?termId=${termId}`, { auth: true }),
      apiFetch<CommentRecord[]>(`/report-comments?termId=${termId}`, { auth: true }),
    ])
      .then(([allStudents, windows, items, ratings, comments]) => {
        const classStudents = allStudents.filter((s) => s.currentClassId === classArmId);
        setStudents(classStudents);
        setWindowStatus(windows[0]?.status ?? null);
        setSkillItems(items);

        const nextRatingDrafts: Record<string, Record<string, RatingValue | "">> = {};
        for (const student of classStudents) {
          const studentDrafts: Record<string, RatingValue | ""> = {};
          for (const item of items) {
            const match = ratings.find(
              (r) => r.studentId === student.id && r.skillAssessmentItemId === item.id,
            );
            studentDrafts[item.id] = match?.rating ?? "";
          }
          nextRatingDrafts[student.id] = studentDrafts;
        }
        setRatingDrafts(nextRatingDrafts);

        const nextCommentDrafts: Record<string, string> = {};
        for (const student of classStudents) {
          const match = comments.find((c) => c.studentId === student.id && c.commentType === "CLASS_TEACHER");
          nextCommentDrafts[student.id] = match?.comment ?? "";
        }
        setCommentDrafts(nextCommentDrafts);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load skills & comments"));
  }, [classArmId, termId, selectedArm, selectedTerm]);

  useEffect(() => {
    load();
  }, [load]);

  const itemsByCategory = useMemo(() => {
    const grouped: Record<SkillCategory, SkillItem[]> = { PSYCHOMOTOR: [], AFFECTIVE_COGNITIVE: [] };
    for (const item of skillItems) grouped[item.category].push(item);
    for (const category of Object.keys(grouped) as SkillCategory[]) {
      grouped[category].sort((a, b) => a.order - b.order);
    }
    return grouped;
  }, [skillItems]);

  const readOnly = !isAdmin && windowStatus !== "OPEN";

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
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
      setSaveState((s) => ({ ...s, [studentId]: "error" }));
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="cts-class-arm">Class arm</Label>
          <Select value={classArmId} onValueChange={setClassArmId}>
            <SelectTrigger id="cts-class-arm" className="mt-1">
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
        <div className="flex items-center gap-2 text-[12.5px] text-muted">
          <span>Report window:</span>
          {windowStatus ? (
            <Badge variant={WINDOW_VARIANT[windowStatus]}>{windowStatus}</Badge>
          ) : (
            <Badge variant="muted">NOT CONFIGURED</Badge>
          )}
          {readOnly && <span className="text-warning">— entry closed until the window is OPEN</span>}
        </div>
      )}

      {!students && classArmId && termId && <p className="text-sm text-muted">Loading…</p>}
      {students && students.length === 0 && <p className="text-sm text-muted">No students in this class arm.</p>}

      {students && students.length > 0 && (
        <div className="space-y-3">
          {students.map((student) => (
            <div key={student.id} className="rounded-lg border border-border p-3">
              <div className="mb-2 flex items-center justify-between">
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

              <div className="grid grid-cols-2 gap-4">
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
        </div>
      )}

      {(!classArmId || !termId) && <p className="text-sm text-muted">Select a class arm and term to begin.</p>}
    </div>
  );
}
