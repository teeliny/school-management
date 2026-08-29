"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { Label } from "../atoms/label";
import { FormField } from "../molecules/form-field";
import { SkeletonList } from "../molecules/skeleton-list";
import { EmptyState } from "../molecules/empty-state";
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

type DepartmentName = "SCIENCE" | "COMMERCIAL" | "ART";
const DEPARTMENT_NAMES: DepartmentName[] = ["SCIENCE", "COMMERCIAL", "ART"];

interface DepartmentItem {
  id: string;
  name: DepartmentName;
  description: string | null;
}

// PRD §3.2: applicable only to SSS-category class levels — a fixed 3-value
// set, so this is "create the ones this school uses" rather than free-text.
export function DepartmentManager() {
  const queryClient = useQueryClient();
  const { data: departments } = useQuery({
    queryKey: ["departments"],
    queryFn: () => apiFetch<DepartmentItem[]>("/departments", { auth: true }),
  });
  const [name, setName] = useState<DepartmentName>("SCIENCE");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDescription, setEditDescription] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function invalidateDepartments() {
    queryClient.invalidateQueries({ queryKey: ["departments"] });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/departments", { method: "POST", auth: true, body: { name, description: description || undefined } });
      setDescription("");
      invalidateDepartments();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(dept: DepartmentItem) {
    setEditingId(dept.id);
    setEditDescription(dept.description ?? "");
  }

  async function saveEdit(id: string) {
    setError(null);
    setEditSubmitting(true);
    try {
      await apiFetch(`/departments/${id}`, {
        method: "PATCH",
        auth: true,
        body: { description: editDescription || undefined },
      });
      setEditingId(null);
      invalidateDepartments();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update department");
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await apiFetch(`/departments/${id}`, { method: "DELETE", auth: true });
      setDeletingId(null);
      invalidateDepartments();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete department");
    }
  }

  const remaining = DEPARTMENT_NAMES.filter((n) => !departments?.some((d) => d.name === n));

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
        {departments === undefined && <SkeletonList rows={2} />}
        {departments?.map((dept) =>
          editingId === dept.id ? (
            <div key={dept.id} className="grid grid-cols-1 items-end gap-2 rounded-lg border border-border p-2.5 sm:grid-cols-[1fr_auto_auto]">
              <FormField
                label={`Description (${dept.name})`}
                id={`dept-edit-description-${dept.id}`}
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
              />
              <Button type="button" size="sm" disabled={editSubmitting} onClick={() => saveEdit(dept.id)}>
                Save
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditingId(null)}>
                Cancel
              </Button>
            </div>
          ) : (
            <div key={dept.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2.5 text-[12.5px]">
              <span>
                {dept.name}
                {dept.description && <span className="text-muted"> — {dept.description}</span>}
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button type="button" variant="outline" size="sm" onClick={() => startEdit(dept)}>
                  Edit
                </Button>
                <AlertDialog open={deletingId === dept.id} onOpenChange={(open) => setDeletingId(open ? dept.id : null)}>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="outline" size="sm">
                      Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogTitle className="text-lg font-semibold">Delete {dept.name}?</AlertDialogTitle>
                    <AlertDialogDescription className="mt-2 text-sm text-muted">
                      Students and subjects assigned to this department may block deletion. This cannot be undone.
                    </AlertDialogDescription>
                    <div className="mt-4 flex justify-end gap-2">
                      <AlertDialogCancel asChild>
                        <Button variant="outline">Cancel</Button>
                      </AlertDialogCancel>
                      <Button onClick={() => handleDelete(dept.id)}>Confirm delete</Button>
                    </div>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ),
        )}
        {departments?.length === 0 && <EmptyState icon={Building2} title="No departments created yet" className="py-6" />}
      </div>

      {remaining.length > 0 && (
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="dept-name">Department</Label>
            <Select value={name} onValueChange={(v) => setName(v as DepartmentName)}>
              <SelectTrigger id="dept-name" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {remaining.map((n) => (
                  <SelectItem key={n} value={n}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <FormField label="Description (optional)" id="dept-description" value={description} onChange={(e) => setDescription(e.target.value)} />
          <Button type="submit" disabled={submitting} className="sm:col-span-2">
            {submitting ? "Creating…" : "Create department"}
          </Button>
        </form>
      )}
    </div>
  );
}
