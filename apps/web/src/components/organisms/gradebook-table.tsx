"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Input } from "../atoms/input";

interface StudentListItem {
  id: string;
  admissionNumber: string;
  currentClassId: string | null;
  user: { firstName: string; lastName: string };
}

interface ScoreEntryItem {
  studentId: string;
  score: number;
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
  const [students, setStudents] = useState<StudentListItem[] | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState<Record<string, "saving" | "saved" | "error">>({});
  const [error, setError] = useState<string | null>(null);
  const draftScores = useRef<Record<string, string>>({});

  const load = useCallback(() => {
    if (!classArmId || !subjectId || !assessmentComponentId) {
      setStudents(null);
      return;
    }
    Promise.all([
      apiFetch<StudentListItem[]>("/students", { auth: true }),
      apiFetch<ScoreEntryItem[]>(`/score-entries?assessmentComponentId=${assessmentComponentId}&classArmId=${classArmId}`, {
        auth: true,
      }),
    ])
      .then(([allStudents, entries]) => {
        setStudents(allStudents.filter((s) => s.currentClassId === classArmId));
        const byStudent: Record<string, number> = {};
        for (const entry of entries) byStudent[entry.studentId] = Number(entry.score);
        setScores(byStudent);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load gradebook"));
  }, [classArmId, subjectId, assessmentComponentId]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveScore(studentId: string) {
    const raw = draftScores.current[studentId];
    if (raw === undefined || raw === "") return;
    const score = Number(raw);
    if (Number.isNaN(score)) return;

    setSaving((s) => ({ ...s, [studentId]: "saving" }));
    try {
      await apiFetch("/score-entries", {
        method: "POST",
        auth: true,
        body: { studentId, subjectId, assessmentComponentId, classArmId, score },
      });
      setScores((s) => ({ ...s, [studentId]: score }));
      setSaving((s) => ({ ...s, [studentId]: "saved" }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save score");
      setSaving((s) => ({ ...s, [studentId]: "error" }));
    }
  }

  if (!classArmId || !subjectId || !assessmentComponentId) {
    return <p className="text-sm text-muted">Select a class arm, subject, and assessment component to begin.</p>;
  }
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!students) return <p className="text-sm text-muted">Loading…</p>;
  if (students.length === 0) return <p className="text-sm text-muted">No students in this class arm.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[12.5px]">
        <thead>
          <tr className="border-b border-border text-muted">
            <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Student</th>
            <th className="py-2 text-[10px] font-medium uppercase tracking-wide">Score / {maxScore}</th>
          </tr>
        </thead>
        <tbody>
          {students.map((student) => (
            <tr key={student.id} className="border-b border-border/60 last:border-none">
              <td className="py-2.5 pr-4 font-medium">
                {student.user.firstName} {student.user.lastName}{" "}
                <span className="font-mono text-muted">({student.admissionNumber})</span>
              </td>
              <td className="w-32 py-2.5">
                <Input
                  type="number"
                  min={0}
                  max={maxScore}
                  defaultValue={scores[student.id] ?? ""}
                  disabled={readOnly}
                  className="w-24 text-center font-mono"
                  onChange={(e) => {
                    draftScores.current[student.id] = e.target.value;
                  }}
                  onBlur={() => saveScore(student.id)}
                />
                {saving[student.id] === "saving" && <span className="ml-2 text-[11px] text-muted">Saving…</span>}
                {saving[student.id] === "saved" && <span className="ml-2 text-[11px] text-success">Saved</span>}
                {saving[student.id] === "error" && <span className="ml-2 text-[11px] text-danger">Failed</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
