"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { Badge } from "../atoms/badge";
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

interface AcademicSessionOption {
  id: string;
  name: string;
  isCurrent: boolean;
}
interface TermItem {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  academicSessionId: string;
}

function toDateInput(value: string) {
  return value.slice(0, 10);
}

// "Current term" has no DB-level singleton guarantee the way AcademicSession
// does (PRD §3.2) — it's scoped to one session at a time and enforced at the
// service layer (TermService.setCurrent). Needed for compulsory subject
// auto-enrollment (PRD §3.3), which resolves against isCurrent=true.
export function TermManager() {
  const queryClient = useQueryClient();
  const { data: sessions = [] } = useQuery({
    queryKey: ["academic-sessions"],
    queryFn: () => apiFetch<AcademicSessionOption[]>("/academic-sessions", { auth: true }),
  });
  const [academicSessionId, setAcademicSessionId] = useState("");
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

  useEffect(() => {
    if (academicSessionId || sessions.length === 0) return;
    const current = sessions.find((s) => s.isCurrent);
    if (current) setAcademicSessionId(current.id);
  }, [sessions, academicSessionId]);

  const { data: terms } = useQuery({
    queryKey: ["terms", academicSessionId],
    queryFn: () => apiFetch<TermItem[]>(`/terms?academicSessionId=${academicSessionId}`, { auth: true }),
    enabled: Boolean(academicSessionId),
  });

  function invalidateTerms() {
    queryClient.invalidateQueries({ queryKey: ["terms", academicSessionId] });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/terms", { method: "POST", auth: true, body: { academicSessionId, name, startDate, endDate } });
      setName("");
      setStartDate("");
      setEndDate("");
      invalidateTerms();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  async function setCurrent(id: string) {
    setError(null);
    try {
      await apiFetch(`/terms/${id}/set-current`, { method: "PATCH", auth: true });
      invalidateTerms();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to set current term");
    }
  }

  function startEdit(term: TermItem) {
    setEditingId(term.id);
    setEditName(term.name);
    setEditStart(toDateInput(term.startDate));
    setEditEnd(toDateInput(term.endDate));
  }

  async function saveEdit(id: string) {
    setError(null);
    setEditSubmitting(true);
    try {
      await apiFetch(`/terms/${id}`, {
        method: "PATCH",
        auth: true,
        body: { name: editName, startDate: editStart, endDate: editEnd },
      });
      setEditingId(null);
      invalidateTerms();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update term");
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await apiFetch(`/terms/${id}`, { method: "DELETE", auth: true });
      setDeletingId(null);
      invalidateTerms();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete term");
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      <div>
        <Label htmlFor="term-session">Academic session</Label>
        <Select value={academicSessionId} onValueChange={setAcademicSessionId}>
          <SelectTrigger id="term-session" className="mt-1">
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

      {terms && (
        <>
          <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
            {terms.map((term) =>
              editingId === term.id ? (
                <div key={term.id} className="grid grid-cols-1 items-end gap-2 rounded-lg border border-border p-2.5 sm:grid-cols-[1fr_1fr_1fr_auto_auto]">
                  <FormField label="Name" id={`term-edit-name-${term.id}`} value={editName} onChange={(e) => setEditName(e.target.value)} />
                  <FormField label="Start date" id={`term-edit-start-${term.id}`} type="date" value={editStart} onChange={(e) => setEditStart(e.target.value)} />
                  <FormField label="End date" id={`term-edit-end-${term.id}`} type="date" value={editEnd} onChange={(e) => setEditEnd(e.target.value)} />
                  <Button type="button" size="sm" disabled={editSubmitting} onClick={() => saveEdit(term.id)}>
                    Save
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditingId(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <div key={term.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2.5 text-[12.5px]">
                  <div>
                    <span className="font-medium">{term.name}</span>{" "}
                    {term.isCurrent && <Badge variant="success">Current</Badge>}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {!term.isCurrent && (
                      <Button type="button" variant="outline" size="sm" onClick={() => setCurrent(term.id)}>
                        Set current
                      </Button>
                    )}
                    <Button type="button" variant="outline" size="sm" onClick={() => startEdit(term)}>
                      Edit
                    </Button>
                    <AlertDialog open={deletingId === term.id} onOpenChange={(open) => setDeletingId(open ? term.id : null)}>
                      <AlertDialogTrigger asChild>
                        <Button type="button" variant="outline" size="sm">
                          Delete
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogTitle className="text-lg font-semibold">Delete {term.name}?</AlertDialogTitle>
                        <AlertDialogDescription className="mt-2 text-sm text-muted">
                          This also removes every subject enrollment and timetable slot tied to this term. This
                          cannot be undone.
                        </AlertDialogDescription>
                        <div className="mt-4 flex justify-end gap-2">
                          <AlertDialogCancel asChild>
                            <Button variant="outline">Cancel</Button>
                          </AlertDialogCancel>
                          <Button onClick={() => handleDelete(term.id)}>Confirm delete</Button>
                        </div>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ),
            )}
            {terms.length === 0 && <p className="text-sm text-muted">No terms in this session yet.</p>}
          </div>

          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FormField label="Name (e.g. Term 1)" id="term-name" required value={name} onChange={(e) => setName(e.target.value)} />
            <FormField label="Start date" id="term-start" type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <FormField label="End date" id="term-end" type="date" required value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            <Button type="submit" disabled={submitting} className="sm:col-span-3">
              {submitting ? "Creating…" : "Create term"}
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
