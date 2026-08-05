"use client";

import { useCallback, useEffect, useState } from "react";
import { CLASS_LEVEL_CATEGORIES, type ClassLevelCategory } from "@school/types";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { Label } from "../atoms/label";
import { FormField } from "../molecules/form-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../molecules/select";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../molecules/alert-dialog";

interface ClassLevelItem {
  id: string;
  name: string;
  order: number;
  category: ClassLevelCategory;
}

export function ClassLevelManager({ onChanged }: { onChanged?: () => void }) {
  const [levels, setLevels] = useState<ClassLevelItem[] | null>(null);
  const [name, setName] = useState("");
  const [order, setOrder] = useState("");
  const [category, setCategory] = useState<ClassLevelCategory>("SSS");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editOrder, setEditOrder] = useState("");
  const [editCategory, setEditCategory] = useState<ClassLevelCategory>("SSS");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<ClassLevelItem[]>("/class-levels", { auth: true })
      .then(setLevels)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load class levels"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/class-levels", { method: "POST", auth: true, body: { name, order: Number(order), category } });
      setName("");
      setOrder("");
      load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(level: ClassLevelItem) {
    setEditingId(level.id);
    setEditName(level.name);
    setEditOrder(String(level.order));
    setEditCategory(level.category);
  }

  async function saveEdit(id: string) {
    setError(null);
    setEditSubmitting(true);
    try {
      await apiFetch(`/class-levels/${id}`, {
        method: "PATCH",
        auth: true,
        body: { name: editName, order: Number(editOrder), category: editCategory },
      });
      setEditingId(null);
      load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update class level");
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await apiFetch(`/class-levels/${id}`, { method: "DELETE", auth: true });
      setDeletingId(null);
      load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete class level");
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="space-y-1.5">
        {levels?.map((level) =>
          editingId === level.id ? (
            <div key={level.id} className="grid grid-cols-1 items-end gap-2 rounded-lg border border-border p-2.5 sm:grid-cols-[1fr_90px_1fr_auto_auto]">
              <FormField label="Name" id={`level-edit-name-${level.id}`} value={editName} onChange={(e) => setEditName(e.target.value)} />
              <FormField label="Order" id={`level-edit-order-${level.id}`} type="number" value={editOrder} onChange={(e) => setEditOrder(e.target.value)} />
              <div>
                <Label htmlFor={`level-edit-category-${level.id}`}>Category</Label>
                <Select value={editCategory} onValueChange={(v) => setEditCategory(v as ClassLevelCategory)}>
                  <SelectTrigger id={`level-edit-category-${level.id}`} className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CLASS_LEVEL_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="button" size="sm" disabled={editSubmitting} onClick={() => saveEdit(level.id)}>
                Save
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditingId(null)}>
                Cancel
              </Button>
            </div>
          ) : (
            <div key={level.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2.5 text-[12.5px]">
              <span>
                {level.name} <span className="text-muted">({level.category}, order {level.order})</span>
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button type="button" variant="outline" size="sm" onClick={() => startEdit(level)}>
                  Edit
                </Button>
                <AlertDialog open={deletingId === level.id} onOpenChange={(open) => setDeletingId(open ? level.id : null)}>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="outline" size="sm">
                      Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogTitle className="text-lg font-semibold">Delete {level.name}?</AlertDialogTitle>
                    <AlertDialogDescription className="mt-2 text-sm text-muted">
                      This cannot be undone. Class arms and subject assignments referencing this level may block
                      deletion.
                    </AlertDialogDescription>
                    <div className="mt-4 flex justify-end gap-2">
                      <AlertDialogCancel asChild>
                        <Button variant="outline">Cancel</Button>
                      </AlertDialogCancel>
                      <Button onClick={() => handleDelete(level.id)}>Confirm delete</Button>
                    </div>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ),
        )}
        {levels?.length === 0 && <p className="text-sm text-muted">No class levels yet.</p>}
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FormField label="Name (e.g. SSS1)" id="level-name" required value={name} onChange={(e) => setName(e.target.value)} />
        <FormField label="Order" id="level-order" type="number" required value={order} onChange={(e) => setOrder(e.target.value)} />
        <div>
          <Label htmlFor="level-category">Category</Label>
          <Select value={category} onValueChange={(v) => setCategory(v as ClassLevelCategory)}>
            <SelectTrigger id="level-category" className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CLASS_LEVEL_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={submitting} className="sm:col-span-3">
          {submitting ? "Creating…" : "Create class level"}
        </Button>
      </form>
    </div>
  );
}
