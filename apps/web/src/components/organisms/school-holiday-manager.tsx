"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarOff } from "lucide-react";
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
interface HolidayItem {
  id: string;
  name: string;
  date: string;
  academicSessionId: string | null;
  termId: string | null;
}

const NONE = "__none__";

function toDateInput(value: string) {
  return value.slice(0, 10);
}

// PRD §3.7: declared holidays are subtracted from the term date range to
// compute "school days opened" (packages/types' computeSchoolDaysOpened),
// which backfills both the attendance-percentage analytics and the FULL_TERM
// report card's attendance line. Admin/Super-Admin only (CASL: SchoolHoliday
// only appears in the unconditioned ADMIN-branch grant).
export function SchoolHolidayManager() {
  const [sessions, setSessions] = useState<AcademicSessionOption[]>([]);
  const [terms, setTerms] = useState<TermOption[]>([]);
  const [holidays, setHolidays] = useState<HolidayItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [academicSessionId, setAcademicSessionId] = useState(NONE);
  const [termId, setTermId] = useState(NONE);
  const [submitting, setSubmitting] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<AcademicSessionOption[]>("/academic-sessions", { auth: true }).then(setSessions).catch(() => setSessions([]));
    apiFetch<TermOption[]>("/terms", { auth: true }).then(setTerms).catch(() => setTerms([]));
  }, []);

  const load = useCallback(() => {
    apiFetch<HolidayItem[]>("/school-holidays", { auth: true })
      .then(setHolidays)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load school holidays"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/school-holidays", {
        method: "POST",
        auth: true,
        body: {
          name,
          date,
          academicSessionId: academicSessionId === NONE ? undefined : academicSessionId,
          termId: termId === NONE ? undefined : termId,
        },
      });
      setName("");
      setDate("");
      setAcademicSessionId(NONE);
      setTermId(NONE);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(holiday: HolidayItem) {
    setEditingId(holiday.id);
    setEditName(holiday.name);
    setEditDate(toDateInput(holiday.date));
  }

  async function saveEdit(id: string) {
    setError(null);
    setEditSubmitting(true);
    try {
      await apiFetch(`/school-holidays/${id}`, { method: "PATCH", auth: true, body: { name: editName, date: editDate } });
      setEditingId(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update holiday");
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await apiFetch(`/school-holidays/${id}`, { method: "DELETE", auth: true });
      setDeletingId(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete holiday");
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
        {holidays === null && <SkeletonList rows={2} />}
        {holidays?.map((holiday) =>
          editingId === holiday.id ? (
            <div
              key={holiday.id}
              className="grid grid-cols-1 items-end gap-2 rounded-lg border border-border p-2.5 sm:grid-cols-[1fr_1fr_auto_auto]"
            >
              <FormField label="Name" id={`holiday-edit-name-${holiday.id}`} value={editName} onChange={(e) => setEditName(e.target.value)} />
              <FormField
                label="Date"
                id={`holiday-edit-date-${holiday.id}`}
                type="date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
              />
              <Button type="button" size="sm" disabled={editSubmitting} onClick={() => saveEdit(holiday.id)}>
                Save
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditingId(null)}>
                Cancel
              </Button>
            </div>
          ) : (
            <div key={holiday.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2.5 text-[12.5px]">
              <span>
                {holiday.name} <span className="font-mono text-muted">({toDateInput(holiday.date)})</span>
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button type="button" variant="outline" size="sm" onClick={() => startEdit(holiday)}>
                  Edit
                </Button>
                <AlertDialog open={deletingId === holiday.id} onOpenChange={(open) => setDeletingId(open ? holiday.id : null)}>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="outline" size="sm">
                      Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogTitle className="text-lg font-semibold">Delete {holiday.name}?</AlertDialogTitle>
                    <AlertDialogDescription className="mt-2 text-sm text-muted">
                      This affects the school-days-opened calculation for any term this date falls within. This cannot
                      be undone.
                    </AlertDialogDescription>
                    <div className="mt-4 flex justify-end gap-2">
                      <AlertDialogCancel asChild>
                        <Button variant="outline">Cancel</Button>
                      </AlertDialogCancel>
                      <Button onClick={() => handleDelete(holiday.id)}>Confirm delete</Button>
                    </div>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ),
        )}
        {holidays?.length === 0 && <EmptyState icon={CalendarOff} title="No school holidays declared yet" className="py-6" />}
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Name" id="holiday-name" required value={name} onChange={(e) => setName(e.target.value)} />
        <FormField label="Date" id="holiday-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        <div>
          <Label htmlFor="holiday-session">Academic session (optional)</Label>
          <Select value={academicSessionId} onValueChange={setAcademicSessionId}>
            <SelectTrigger id="holiday-session" className="mt-1">
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
          <Label htmlFor="holiday-term">Term (optional)</Label>
          <Select value={termId} onValueChange={setTermId}>
            <SelectTrigger id="holiday-term" className="mt-1">
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
          {submitting ? "Creating…" : "Declare holiday"}
        </Button>
      </form>
    </div>
  );
}
