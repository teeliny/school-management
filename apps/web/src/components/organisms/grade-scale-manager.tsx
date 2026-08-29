"use client";

import { useCallback, useEffect, useState } from "react";
import { GraduationCap } from "lucide-react";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { FormField } from "../molecules/form-field";
import { SkeletonList } from "../molecules/skeleton-list";
import { EmptyState } from "../molecules/empty-state";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../molecules/alert-dialog";

interface GradeScaleItem {
  id: string;
  minScore: number;
  maxScore: number;
  grade: string;
  remark: string | null;
  gradePoint: number | null;
}

export function GradeScaleManager() {
  const [scales, setScales] = useState<GradeScaleItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [minScore, setMinScore] = useState("");
  const [maxScore, setMaxScore] = useState("");
  const [grade, setGrade] = useState("");
  const [remark, setRemark] = useState("");
  const [gradePoint, setGradePoint] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<GradeScaleItem[]>("/grade-scales", { auth: true })
      .then(setScales)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load grade scales"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function resetForm() {
    setMinScore("");
    setMaxScore("");
    setGrade("");
    setRemark("");
    setGradePoint("");
  }

  function startEdit(scale: GradeScaleItem) {
    setEditingId(scale.id);
    setMinScore(String(scale.minScore));
    setMaxScore(String(scale.maxScore));
    setGrade(scale.grade);
    setRemark(scale.remark ?? "");
    setGradePoint(scale.gradePoint !== null ? String(scale.gradePoint) : "");
  }

  function cancelEdit() {
    setEditingId(null);
    resetForm();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const body = {
        minScore: Number(minScore),
        maxScore: Number(maxScore),
        grade,
        remark: remark || undefined,
        gradePoint: gradePoint ? Number(gradePoint) : undefined,
      };

      if (editingId) {
        await apiFetch(`/grade-scales/${editingId}`, { method: "PATCH", auth: true, body });
        setEditingId(null);
      } else {
        await apiFetch("/grade-scales", { method: "POST", auth: true, body });
      }
      resetForm();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await apiFetch(`/grade-scales/${id}`, { method: "DELETE", auth: true });
      setDeletingId(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete grade scale");
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
        {scales === null && <SkeletonList rows={3} />}
        {scales
          ?.slice()
          .sort((a, b) => b.minScore - a.minScore)
          .map((scale) => (
            <div key={scale.id} className="flex items-center justify-between rounded-lg border border-border p-2.5 text-[12.5px]">
              <span>
                <span className="font-mono font-medium">{scale.grade}</span>{" "}
                <span className="text-muted">
                  ({scale.minScore}–{scale.maxScore}
                  {scale.remark ? `, ${scale.remark}` : ""}
                  {scale.gradePoint !== null ? `, ${scale.gradePoint} pts` : ""})
                </span>
              </span>
              <div className="flex items-center gap-1.5">
                <Button type="button" variant="outline" size="sm" onClick={() => startEdit(scale)}>
                  Edit
                </Button>
                <AlertDialog open={deletingId === scale.id} onOpenChange={(open) => setDeletingId(open ? scale.id : null)}>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="outline" size="sm">
                      Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogTitle className="text-lg font-semibold">Delete grade {scale.grade}?</AlertDialogTitle>
                    <AlertDialogDescription className="mt-2 text-sm text-muted">This cannot be undone.</AlertDialogDescription>
                    <div className="mt-4 flex justify-end gap-2">
                      <AlertDialogCancel asChild>
                        <Button variant="outline">Cancel</Button>
                      </AlertDialogCancel>
                      <Button onClick={() => handleDelete(scale.id)}>Confirm delete</Button>
                    </div>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ))}
        {scales?.length === 0 && <EmptyState icon={GraduationCap} title="No grade scale rows yet" />}
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-5 gap-3">
        <FormField label="Min score" id="gs-min" type="number" required value={minScore} onChange={(e) => setMinScore(e.target.value)} />
        <FormField label="Max score" id="gs-max" type="number" required value={maxScore} onChange={(e) => setMaxScore(e.target.value)} />
        <FormField label="Grade (e.g. A1)" id="gs-grade" required value={grade} onChange={(e) => setGrade(e.target.value)} />
        <FormField label="Remark" id="gs-remark" value={remark} onChange={(e) => setRemark(e.target.value)} />
        <FormField label="Grade point" id="gs-point" type="number" value={gradePoint} onChange={(e) => setGradePoint(e.target.value)} />
        <div className="col-span-5 flex gap-2">
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Saving…" : editingId ? "Save changes" : "Add grade scale row"}
          </Button>
          {editingId && (
            <Button type="button" variant="outline" onClick={cancelEdit}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
