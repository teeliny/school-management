"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { Badge } from "../atoms/badge";
import { Label } from "../atoms/label";
import { Checkbox } from "../atoms/checkbox";
import { FormField } from "../molecules/form-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../molecules/alert-dialog";

type SkillCategory = "PSYCHOMOTOR" | "AFFECTIVE_COGNITIVE";
const CATEGORIES: SkillCategory[] = ["PSYCHOMOTOR", "AFFECTIVE_COGNITIVE"];
const CATEGORY_LABEL: Record<SkillCategory, string> = {
  PSYCHOMOTOR: "Psychomotor",
  AFFECTIVE_COGNITIVE: "Affective & Cognitive",
};

interface AcademicSessionOption {
  id: string;
  name: string;
  isCurrent: boolean;
}
interface SkillAssessmentItemRow {
  id: string;
  category: SkillCategory;
  name: string;
  order: number;
  isActive: boolean;
}

export function SkillAssessmentItemManager() {
  const [sessions, setSessions] = useState<AcademicSessionOption[]>([]);
  const [academicSessionId, setAcademicSessionId] = useState("");
  const [items, setItems] = useState<SkillAssessmentItemRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [category, setCategory] = useState<SkillCategory>("PSYCHOMOTOR");
  const [name, setName] = useState("");
  const [order, setOrder] = useState("1");
  const [isActive, setIsActive] = useState(true);

  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<AcademicSessionOption[]>("/academic-sessions", { auth: true })
      .then((fetched) => {
        setSessions(fetched);
        const current = fetched.find((s) => s.isCurrent);
        if (current) setAcademicSessionId(current.id);
      })
      .catch(() => setSessions([]));
  }, []);

  const load = useCallback(() => {
    if (!academicSessionId) {
      setItems(null);
      return;
    }
    apiFetch<SkillAssessmentItemRow[]>(`/skill-assessment-items?academicSessionId=${academicSessionId}`, {
      auth: true,
    })
      .then(setItems)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load skill assessment items"));
  }, [academicSessionId]);

  useEffect(() => {
    load();
  }, [load]);

  function resetForm() {
    setCategory("PSYCHOMOTOR");
    setName("");
    setOrder("1");
    setIsActive(true);
  }

  function startEdit(item: SkillAssessmentItemRow) {
    setEditingId(item.id);
    setCategory(item.category);
    setName(item.name);
    setOrder(String(item.order));
    setIsActive(item.isActive);
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
      if (editingId) {
        await apiFetch(`/skill-assessment-items/${editingId}`, {
          method: "PATCH",
          auth: true,
          body: { category, name, order: Number(order), isActive },
        });
        setEditingId(null);
      } else {
        await apiFetch("/skill-assessment-items", {
          method: "POST",
          auth: true,
          body: { academicSessionId, category, name, order: Number(order) },
        });
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
      await apiFetch(`/skill-assessment-items/${id}`, { method: "DELETE", auth: true });
      setDeletingId(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete skill assessment item");
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      <div>
        <Label htmlFor="sai-session">Academic session</Label>
        <Select value={academicSessionId} onValueChange={setAcademicSessionId}>
          <SelectTrigger id="sai-session" className="mt-1">
            <SelectValue placeholder="Select session" />
          </SelectTrigger>
          <SelectContent>
            {sessions.map((session) => (
              <SelectItem key={session.id} value={session.id}>
                {session.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="mt-1 text-[11px] text-muted">
          A session with no items yet is auto-filled from the most recent prior session on first load.
        </p>
      </div>

      {items && (
        <>
          {CATEGORIES.map((cat) => {
            const catItems = items.filter((i) => i.category === cat).sort((a, b) => a.order - b.order);
            return (
              <div key={cat}>
                <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
                  {CATEGORY_LABEL[cat]}
                </div>
                <div className="space-y-1.5">
                  {catItems.map((item) => (
                    <div key={item.id} className="flex items-center justify-between rounded-lg border border-border p-2.5 text-[12.5px]">
                      <span>
                        {item.name} <span className="font-mono text-muted">(order {item.order})</span>{" "}
                        {!item.isActive && <Badge variant="muted">Inactive</Badge>}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <Button type="button" variant="outline" size="sm" onClick={() => startEdit(item)}>
                          Edit
                        </Button>
                        <AlertDialog open={deletingId === item.id} onOpenChange={(open) => setDeletingId(open ? item.id : null)}>
                          <AlertDialogTrigger asChild>
                            <Button type="button" variant="outline" size="sm">
                              Delete
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogTitle className="text-lg font-semibold">Delete {item.name}?</AlertDialogTitle>
                            <AlertDialogDescription className="mt-2 text-sm text-muted">
                              This cannot be undone.
                            </AlertDialogDescription>
                            <div className="mt-4 flex justify-end gap-2">
                              <AlertDialogCancel asChild>
                                <Button variant="outline">Cancel</Button>
                              </AlertDialogCancel>
                              <Button onClick={() => handleDelete(item.id)}>Confirm delete</Button>
                            </div>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  ))}
                  {catItems.length === 0 && <p className="text-sm text-muted">None yet.</p>}
                </div>
              </div>
            );
          })}

          <form onSubmit={handleSubmit} className="grid grid-cols-4 gap-3">
            <div>
              <Label htmlFor="sai-category">Category</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as SkillCategory)}>
                <SelectTrigger id="sai-category" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {CATEGORY_LABEL[cat]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <FormField label="Name (e.g. Punctuality)" id="sai-name" required value={name} onChange={(e) => setName(e.target.value)} />
            <FormField label="Order" id="sai-order" type="number" required value={order} onChange={(e) => setOrder(e.target.value)} />
            {editingId ? (
              <div className="flex items-end gap-2 self-end">
                <label className="mb-2.5 flex items-center gap-1.5 text-[12.5px]">
                  <Checkbox checked={isActive} onCheckedChange={(v) => setIsActive(v === true)} />
                  Active
                </label>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Saving…" : "Save changes"}
                </Button>
                <Button type="button" variant="outline" onClick={cancelEdit}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button type="submit" disabled={submitting} className="self-end">
                {submitting ? "Adding…" : "Add item"}
              </Button>
            )}
          </form>
        </>
      )}
      {!items && <p className="text-sm text-muted">Select an academic session to manage skill items.</p>}
    </div>
  );
}
