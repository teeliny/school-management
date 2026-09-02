"use client";

import { useCallback, useEffect, useState } from "react";
import { PartyPopper } from "lucide-react";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { Label } from "../atoms/label";
import { FormField } from "../molecules/form-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";
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

interface AcademicSessionOption {
  id: string;
  name: string;
}
interface TermOption {
  id: string;
  name: string;
  academicSessionId: string;
}
interface SchoolEventItem {
  id: string;
  name: string;
  description: string | null;
  date: string;
  endDate: string | null;
  academicSessionId: string | null;
  termId: string | null;
}

const NONE = "__none__";

function toDateInput(value: string) {
  return value.slice(0, 10);
}

// A school-wide activity that isn't tied to any class-scheduling table (Clubs
// Day, Inter-house Sports, an excursion) — shown on the Calendar (/calendar)
// to every user alongside term/assessment/report-window dates and public
// holidays. Admin/Principal/Headteacher only (CASL: gated on "manage
// AcademicStructure", same as ClassLevel/ClassArm — see school-event.ts).
export function SchoolEventManager() {
  const [sessions, setSessions] = useState<AcademicSessionOption[]>([]);
  const [terms, setTerms] = useState<TermOption[]>([]);
  const [events, setEvents] = useState<SchoolEventItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [academicSessionId, setAcademicSessionId] = useState(NONE);
  const [termId, setTermId] = useState(NONE);
  const [submitting, setSubmitting] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editEndDate, setEditEndDate] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<AcademicSessionOption[]>("/academic-sessions", { auth: true }).then(setSessions).catch(() => setSessions([]));
    apiFetch<TermOption[]>("/terms", { auth: true }).then(setTerms).catch(() => setTerms([]));
  }, []);

  const load = useCallback(() => {
    apiFetch<SchoolEventItem[]>("/school-events", { auth: true })
      .then(setEvents)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load school events"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/school-events", {
        method: "POST",
        auth: true,
        body: {
          name,
          description: description.trim() || undefined,
          date,
          endDate: endDate || undefined,
          academicSessionId: academicSessionId === NONE ? undefined : academicSessionId,
          termId: termId === NONE ? undefined : termId,
        },
      });
      setName("");
      setDescription("");
      setDate("");
      setEndDate("");
      setAcademicSessionId(NONE);
      setTermId(NONE);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(event: SchoolEventItem) {
    setEditingId(event.id);
    setEditName(event.name);
    setEditDescription(event.description ?? "");
    setEditDate(toDateInput(event.date));
    setEditEndDate(event.endDate ? toDateInput(event.endDate) : "");
  }

  async function saveEdit(id: string) {
    setError(null);
    setEditSubmitting(true);
    try {
      await apiFetch(`/school-events/${id}`, {
        method: "PATCH",
        auth: true,
        body: {
          name: editName,
          description: editDescription.trim() || null,
          date: editDate,
          endDate: editEndDate || null,
        },
      });
      setEditingId(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update event");
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await apiFetch(`/school-events/${id}`, { method: "DELETE", auth: true });
      setDeletingId(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete event");
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
        {events === null && <SkeletonList rows={2} />}
        {events?.map((event) =>
          editingId === event.id ? (
            <div key={event.id} className="grid grid-cols-1 items-end gap-2 rounded-lg border border-border p-2.5 sm:grid-cols-2">
              <FormField label="Name" id={`event-edit-name-${event.id}`} value={editName} onChange={(e) => setEditName(e.target.value)} />
              <FormField
                label="Description (optional)"
                id={`event-edit-description-${event.id}`}
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
              />
              <FormField
                label="Date"
                id={`event-edit-date-${event.id}`}
                type="date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
              />
              <FormField
                label="End date (optional)"
                id={`event-edit-end-date-${event.id}`}
                type="date"
                value={editEndDate}
                onChange={(e) => setEditEndDate(e.target.value)}
              />
              <div className="flex gap-2 sm:col-span-2">
                <Button type="button" size="sm" disabled={editSubmitting} onClick={() => saveEdit(event.id)}>
                  Save
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setEditingId(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div key={event.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2.5 text-[12.5px]">
              <span>
                {event.name}{" "}
                <span className="font-mono text-muted">
                  ({toDateInput(event.date)}
                  {event.endDate ? ` → ${toDateInput(event.endDate)}` : ""})
                </span>
                {event.description && <span className="text-muted"> — {event.description}</span>}
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button type="button" variant="outline" size="sm" onClick={() => startEdit(event)}>
                  Edit
                </Button>
                <AlertDialog open={deletingId === event.id} onOpenChange={(open) => setDeletingId(open ? event.id : null)}>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="outline" size="sm">
                      Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogTitle className="text-lg font-semibold">Delete {event.name}?</AlertDialogTitle>
                    <AlertDialogDescription className="mt-2 text-sm text-muted">
                      This removes it from every user&apos;s Calendar view. This cannot be undone.
                    </AlertDialogDescription>
                    <div className="mt-4 flex justify-end gap-2">
                      <AlertDialogCancel asChild>
                        <Button variant="outline">Cancel</Button>
                      </AlertDialogCancel>
                      <Button onClick={() => handleDelete(event.id)}>Confirm delete</Button>
                    </div>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ),
        )}
        {events?.length === 0 && <EmptyState icon={PartyPopper} title="No school events yet" className="py-6" />}
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Name (e.g. Inter-house Sports)" id="event-name" required value={name} onChange={(e) => setName(e.target.value)} />
        <FormField
          label="Description (optional)"
          id="event-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <FormField label="Date" id="event-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        <FormField
          label="End date (optional, for a multi-day event)"
          id="event-end-date"
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
        <div>
          <Label htmlFor="event-session">Academic session (optional)</Label>
          <Select value={academicSessionId} onValueChange={setAcademicSessionId}>
            <SelectTrigger id="event-session" className="mt-1">
              <SelectValue placeholder="Not tied to a session" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Not tied to a session</SelectItem>
              {sessions.map((session) => (
                <SelectItem key={session.id} value={session.id}>
                  {session.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="event-term">Term (optional)</Label>
          <Select value={termId} onValueChange={setTermId}>
            <SelectTrigger id="event-term" className="mt-1">
              <SelectValue placeholder="Not tied to a term" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Not tied to a term</SelectItem>
              {terms.map((term) => (
                <SelectItem key={term.id} value={term.id}>
                  {term.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={submitting} className="sm:col-span-2">
          {submitting ? "Creating…" : "Add event"}
        </Button>
      </form>
    </div>
  );
}
