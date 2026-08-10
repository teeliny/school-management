"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { usePaginatedStudents } from "../../lib/use-paginated-students";
import { Input } from "../atoms/input";
import { PaginatedStudentList } from "./paginated-student-list";

interface ScoreEntryItem {
  studentId: string;
  score: number;
}

interface ScoreSummary {
  totalStudents: number;
  enteredCount: number;
}

/**
 * PRD §3.6/FR4.2: score entry is only accepted while the chosen component is
 * OPEN (or as an Admin override) — this table doesn't re-implement that
 * check, the API is authoritative and rejects otherwise. `readOnly` mirrors
 * that at the UI layer too, so a teacher never sees an editable input for a
 * component that isn't OPEN (Admin can still be handed readOnly=false for
 * any status, since they have the override).
 */
export function GradebookTable({
  classArmId,
  subjectId,
  assessmentComponentId,
  maxScore,
  readOnly,
}: {
  classArmId: string;
  subjectId: string;
  assessmentComponentId: string;
  maxScore: number;
  readOnly: boolean;
}) {
  const { students, total, loading, error: listError, hasMore, search, setSearch, loadMore } = usePaginatedStudents({
    classArmId,
  });
  const [scores, setScores] = useState<Record<string, number>>({});
  const [draftScores, setDraftScores] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, "saving" | "saved" | "error" | "invalid">>({});
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ScoreSummary | null>(null);
  // Guards against a late (out-of-order) loadScores response overwriting a
  // newer one once the user has already switched subject/component again.
  const loadRequestId = useRef(0);

  // The four keys a native number input otherwise lets through that would
  // still produce a non-sensical score: minus (negative), plus, and the two
  // exponent-notation letters (e.g. typing "e" turns "1" into scientific
  // notation "1e...").
  const BLOCKED_KEYS = new Set(["-", "+", "e", "E"]);

  const loadScores = useCallback(() => {
    if (!classArmId || !subjectId || !assessmentComponentId) return;
    const thisRequest = ++loadRequestId.current;
    // Clear immediately (not just on resolve) so a row that remounts for the
    // new subject/component never briefly shows the previous selection's
    // committed value while the fetch for the new one is still in flight.
    setScores({});
    setDraftScores({});
    setSaving({});
    apiFetch<ScoreEntryItem[]>(
      `/score-entries?subjectId=${subjectId}&assessmentComponentId=${assessmentComponentId}&classArmId=${classArmId}`,
      { auth: true },
    )
      .then((entries) => {
        if (thisRequest !== loadRequestId.current) return;
        const byStudent: Record<string, number> = {};
        for (const entry of entries) byStudent[entry.studentId] = Number(entry.score);
        setScores(byStudent);
      })
      .catch((err) => {
        if (thisRequest !== loadRequestId.current) return;
        setError(err instanceof ApiError ? err.message : "Failed to load gradebook");
      });
  }, [classArmId, subjectId, assessmentComponentId]);

  const loadSummary = useCallback(() => {
    if (!classArmId || !subjectId || !assessmentComponentId) {
      setSummary(null);
      return;
    }
    apiFetch<ScoreSummary>(
      `/score-entries/summary?classArmId=${classArmId}&subjectId=${subjectId}&assessmentComponentId=${assessmentComponentId}`,
      { auth: true },
    )
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [classArmId, subjectId, assessmentComponentId]);

  useEffect(() => {
    loadScores();
    loadSummary();
  }, [loadScores, loadSummary]);

  async function saveScore(studentId: string) {
    const raw = draftScores[studentId];
    if (raw === undefined || raw === "") return;
    const score = Number(raw);
    if (Number.isNaN(score) || score < 0 || score > maxScore) {
      setSaving((s) => ({ ...s, [studentId]: "invalid" }));
      return;
    }

    // Captured so a save that resolves after the user has already switched
    // subject/component doesn't write a stale-context result into the
    // now-different `scores`/`saving` state.
    const savedSubjectId = subjectId;
    const savedComponentId = assessmentComponentId;
    const stillCurrent = () => subjectId === savedSubjectId && assessmentComponentId === savedComponentId;

    setSaving((s) => ({ ...s, [studentId]: "saving" }));
    try {
      await apiFetch("/score-entries", {
        method: "POST",
        auth: true,
        body: { studentId, subjectId: savedSubjectId, assessmentComponentId: savedComponentId, classArmId, score },
      });
      if (!stillCurrent()) return;
      setScores((s) => {
        const wasAlreadyEntered = studentId in s;
        if (!wasAlreadyEntered) {
          setSummary((prev) => (prev ? { ...prev, enteredCount: prev.enteredCount + 1 } : prev));
        }
        return { ...s, [studentId]: score };
      });
      setDraftScores((d) => {
        const next = { ...d };
        delete next[studentId];
        return next;
      });
      setSaving((s) => ({ ...s, [studentId]: "saved" }));
    } catch (err) {
      if (!stillCurrent()) return;
      setError(err instanceof ApiError ? err.message : "Failed to save score");
      setSaving((s) => ({ ...s, [studentId]: "error" }));
    }
  }

  if (!classArmId || !subjectId || !assessmentComponentId) {
    return <p className="text-sm text-muted">Select a class arm, subject, and assessment component to begin.</p>;
  }
  if (error) return <p className="text-sm text-danger">{error}</p>;

  return (
    <div className="space-y-2.5">
      {summary && (
        <p className="text-[12px] text-muted">
          {summary.enteredCount} of {summary.totalStudents} students scored
        </p>
      )}
      <PaginatedStudentList
        studentCount={students.length}
        total={total}
        loading={loading}
        error={listError}
        hasMore={hasMore}
        search={search}
        onSearchChange={setSearch}
        onLoadMore={loadMore}
      >
        <table className="w-full text-left text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-muted">
              <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Student</th>
              <th className="py-2 text-[10px] font-medium uppercase tracking-wide">Score / {maxScore}</th>
            </tr>
          </thead>
          <tbody>
            {students.map((student) => (
              <tr
                key={`${subjectId}-${assessmentComponentId}-${student.id}`}
                className="border-b border-border/60 last:border-none"
              >
                <td className="py-2.5 pr-4 font-medium">
                  {student.user.firstName} {student.user.lastName}{" "}
                  <span className="font-mono text-muted">({student.admissionNumber})</span>
                </td>
                <td className="w-32 py-2.5">
                  <Input
                    type="number"
                    min={0}
                    max={maxScore}
                    step="any"
                    value={draftScores[student.id] ?? (scores[student.id] !== undefined ? String(scores[student.id]) : "")}
                    disabled={readOnly}
                    className="w-24 text-center font-mono"
                    onKeyDown={(e) => {
                      if (BLOCKED_KEYS.has(e.key)) e.preventDefault();
                    }}
                    onChange={(e) => {
                      const { value } = e.target;
                      setDraftScores((d) => ({ ...d, [student.id]: value }));
                      if (student.id in saving) {
                        setSaving((s) => Object.fromEntries(Object.entries(s).filter(([id]) => id !== student.id)));
                      }
                    }}
                    onBlur={() => saveScore(student.id)}
                  />
                  {saving[student.id] === "saving" && <span className="ml-2 text-[11px] text-muted">Saving…</span>}
                  {saving[student.id] === "saved" && <span className="ml-2 text-[11px] text-success">Saved</span>}
                  {saving[student.id] === "error" && <span className="ml-2 text-[11px] text-danger">Failed</span>}
                  {saving[student.id] === "invalid" && (
                    <span className="ml-2 text-[11px] text-danger">Must be 0–{maxScore}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </PaginatedStudentList>
    </div>
  );
}
