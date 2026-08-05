"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { Badge } from "../atoms/badge";
import { FormField } from "../molecules/form-field";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../molecules/alert-dialog";

interface AcademicSessionItem {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
}

function toDateInput(value: string) {
  return value.slice(0, 10);
}

// PRD §3.2: exactly one AcademicSession is current at a time (DB-enforced
// partial unique index, ARCHITECTURE.md §6.1) — everything else in the app
// (class arms, staff assignments, subject catalogue per session) hangs off
// whichever session is current.
export function AcademicSessionManager({ onChanged }: { onChanged?: () => void }) {
  const [sessions, setSessions] = useState<AcademicSessionItem[] | null>(null);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<AcademicSessionItem[]>("/academic-sessions", { auth: true })
      .then(setSessions)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load sessions"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/academic-sessions", { method: "POST", auth: true, body: { name, startDate, endDate } });
      setName("");
      setStartDate("");
      setEndDate("");
      load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  async function setCurrent(id: string) {
    setError(null);
    try {
      await apiFetch(`/academic-sessions/${id}/set-current`, { method: "PATCH", auth: true });
      load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to set current session");
    }
  }

  function startEdit(session: AcademicSessionItem) {
    setEditingId(session.id);
    setEditName(session.name);
    setEditStart(toDateInput(session.startDate));
    setEditEnd(toDateInput(session.endDate));
  }

  async function saveEdit(id: string) {
    setError(null);
    setEditSubmitting(true);
    try {
      await apiFetch(`/academic-sessions/${id}`, {
        method: "PATCH",
        auth: true,
        body: { name: editName, startDate: editStart, endDate: editEnd },
      });
      setEditingId(null);
      load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update session");
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await apiFetch(`/academic-sessions/${id}`, { method: "DELETE", auth: true });
      setDeletingId(null);
      load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete session");
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
        {sessions?.map((session) =>
          editingId === session.id ? (
            <div key={session.id} className="grid grid-cols-1 items-end gap-2 rounded-lg border border-border p-2.5 sm:grid-cols-[1fr_1fr_1fr_auto_auto]">
              <FormField label="Name" id={`session-edit-name-${session.id}`} value={editName} onChange={(e) => setEditName(e.target.value)} />
              <FormField label="Start date" id={`session-edit-start-${session.id}`} type="date" value={editStart} onChange={(e) => setEditStart(e.target.value)} />
              <FormField label="End date" id={`session-edit-end-${session.id}`} type="date" value={editEnd} onChange={(e) => setEditEnd(e.target.value)} />
              <Button type="button" size="sm" disabled={editSubmitting} onClick={() => saveEdit(session.id)}>
                Save
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditingId(null)}>
                Cancel
              </Button>
            </div>
          ) : (
            <div key={session.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2.5 text-[12.5px]">
              <div>
                <span className="font-medium">{session.name}</span>{" "}
                {session.isCurrent && <Badge variant="success">Current</Badge>}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {!session.isCurrent && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setCurrent(session.id)}>
                    Set current
                  </Button>
                )}
                <Button type="button" variant="outline" size="sm" onClick={() => startEdit(session)}>
                  Edit
                </Button>
                <AlertDialog open={deletingId === session.id} onOpenChange={(open) => setDeletingId(open ? session.id : null)}>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="outline" size="sm">
                      Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogTitle className="text-lg font-semibold">Delete {session.name}?</AlertDialogTitle>
                    <AlertDialogDescription className="mt-2 text-sm text-muted">
                      This also removes every term, class arm, subject assignment, and timetable slot tied to this
                      session. This cannot be undone.
                    </AlertDialogDescription>
                    <div className="mt-4 flex justify-end gap-2">
                      <AlertDialogCancel asChild>
                        <Button variant="outline">Cancel</Button>
                      </AlertDialogCancel>
                      <Button onClick={() => handleDelete(session.id)}>Confirm delete</Button>
                    </div>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ),
        )}
        {sessions?.length === 0 && <p className="text-sm text-muted">No academic sessions yet.</p>}
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FormField label="Name (e.g. 2025/2026)" id="session-name" required value={name} onChange={(e) => setName(e.target.value)} />
        <FormField label="Start date" id="session-start" type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <FormField label="End date" id="session-end" type="date" required value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        <Button type="submit" disabled={submitting} className="sm:col-span-3">
          {submitting ? "Creating…" : "Create session"}
        </Button>
      </form>
    </div>
  );
}
