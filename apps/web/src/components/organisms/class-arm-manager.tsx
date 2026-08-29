"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { School } from "lucide-react";
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

interface ClassLevelOption {
  id: string;
  name: string;
}
interface AcademicSessionOption {
  id: string;
  name: string;
}
interface ClassArmItem {
  id: string;
  name: string;
  displayName: string;
  capacity: number | null;
  classLevelId: string;
  academicSessionId: string;
}

export function ClassArmManager() {
  const queryClient = useQueryClient();
  const { data: classLevels = [] } = useQuery({
    queryKey: ["class-levels"],
    queryFn: () => apiFetch<ClassLevelOption[]>("/class-levels", { auth: true }),
  });
  const { data: sessions = [] } = useQuery({
    queryKey: ["academic-sessions"],
    queryFn: () => apiFetch<AcademicSessionOption[]>("/academic-sessions", { auth: true }),
  });
  const { data: arms } = useQuery({
    queryKey: ["class-arms"],
    queryFn: () => apiFetch<ClassArmItem[]>("/class-arms", { auth: true }),
  });
  const [classLevelId, setClassLevelId] = useState("");
  const [academicSessionId, setAcademicSessionId] = useState("");
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCapacity, setEditCapacity] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function invalidateArms() {
    queryClient.invalidateQueries({ queryKey: ["class-arms"] });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/class-arms", {
        method: "POST",
        auth: true,
        body: { classLevelId, academicSessionId, name, capacity: capacity ? Number(capacity) : undefined },
      });
      setName("");
      setCapacity("");
      invalidateArms();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(arm: ClassArmItem) {
    setEditingId(arm.id);
    setEditName(arm.name);
    setEditCapacity(arm.capacity ? String(arm.capacity) : "");
  }

  async function saveEdit(id: string) {
    setError(null);
    setEditSubmitting(true);
    try {
      await apiFetch(`/class-arms/${id}`, {
        method: "PATCH",
        auth: true,
        body: { name: editName, capacity: editCapacity ? Number(editCapacity) : undefined },
      });
      setEditingId(null);
      invalidateArms();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update class arm");
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await apiFetch(`/class-arms/${id}`, { method: "DELETE", auth: true });
      setDeletingId(null);
      invalidateArms();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete class arm");
    }
  }

  const sessionById = new Map(sessions.map((s) => [s.id, s.name]));

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
        {arms === undefined && <SkeletonList rows={3} />}
        {arms?.map((arm) =>
          editingId === arm.id ? (
            <div key={arm.id} className="grid grid-cols-1 items-end gap-2 rounded-lg border border-border p-2.5 sm:grid-cols-[1fr_120px_auto_auto]">
              <FormField label="Name" id={`arm-edit-name-${arm.id}`} value={editName} onChange={(e) => setEditName(e.target.value)} />
              <FormField label="Capacity" id={`arm-edit-capacity-${arm.id}`} type="number" value={editCapacity} onChange={(e) => setEditCapacity(e.target.value)} />
              <Button type="button" size="sm" disabled={editSubmitting} onClick={() => saveEdit(arm.id)}>
                Save
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditingId(null)}>
                Cancel
              </Button>
            </div>
          ) : (
            <div key={arm.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2.5 text-[12.5px]">
              <span>
                {arm.displayName}{" "}
                <span className="text-muted">
                  ({sessionById.get(arm.academicSessionId) ?? "?"}
                  {arm.capacity ? ` · cap ${arm.capacity}` : ""})
                </span>
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button type="button" variant="outline" size="sm" onClick={() => startEdit(arm)}>
                  Edit
                </Button>
                <AlertDialog open={deletingId === arm.id} onOpenChange={(open) => setDeletingId(open ? arm.id : null)}>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="outline" size="sm">
                      Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogTitle className="text-lg font-semibold">Delete {arm.displayName}?</AlertDialogTitle>
                    <AlertDialogDescription className="mt-2 text-sm text-muted">
                      Students currently assigned to this class arm, plus its subject enrollments and timetable
                      slots, are affected. This cannot be undone.
                    </AlertDialogDescription>
                    <div className="mt-4 flex justify-end gap-2">
                      <AlertDialogCancel asChild>
                        <Button variant="outline">Cancel</Button>
                      </AlertDialogCancel>
                      <Button onClick={() => handleDelete(arm.id)}>Confirm delete</Button>
                    </div>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ),
        )}
        {arms?.length === 0 && <EmptyState icon={School} title="No class arms yet" className="py-6" />}
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="arm-level">Class level</Label>
            <Select value={classLevelId} onValueChange={setClassLevelId}>
              <SelectTrigger id="arm-level" className="mt-1">
                <SelectValue placeholder="Select class level" />
              </SelectTrigger>
              <SelectContent>
                {classLevels.map((level) => (
                  <SelectItem key={level.id} value={level.id}>
                    {level.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="arm-session">Academic session</Label>
            <Select value={academicSessionId} onValueChange={setAcademicSessionId}>
              <SelectTrigger id="arm-session" className="mt-1">
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
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField
            label="Arm name"
            id="arm-name"
            placeholder="e.g. Topaz — just the arm, not the class level"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <FormField label="Capacity (optional)" id="arm-capacity" type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </div>
        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? "Creating…" : "Create class arm"}
        </Button>
      </form>
    </div>
  );
}
