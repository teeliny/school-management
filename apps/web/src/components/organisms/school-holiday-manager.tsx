"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarOff } from "lucide-react";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { Checkbox } from "../atoms/checkbox";
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

interface HolidayGroup {
  key: string;
  name: string;
  academicSessionId: string | null;
  termId: string | null;
  ids: string[];
  startDate: string;
  endDate: string;
}

// Two date-only (YYYY-MM-DD) strings are "adjacent" if they're back to back,
// or separated only by a weekend — the same gap createRange's own
// day-by-day loop produces when it skips Sat/Sun (school-holiday.ts,
// apps/api). This is purely a display grouping: the backend still stores
// one row per day (PRD §3.7 — computeSchoolDaysOpened wants per-day rows),
// this just collapses a contiguous run of them back into the range the
// admin actually entered.
function isAdjacentSkippingWeekends(prev: string, next: string): boolean {
  const prevDate = new Date(`${prev}T00:00:00.000Z`);
  const nextDate = new Date(`${next}T00:00:00.000Z`);
  const diffDays = Math.round((nextDate.getTime() - prevDate.getTime()) / 86_400_000);
  if (diffDays <= 0) return false;
  for (let i = 1; i < diffDays; i++) {
    const dow = new Date(prevDate.getTime() + i * 86_400_000).getUTCDay();
    if (dow !== 0 && dow !== 6) return false;
  }
  return true;
}

function groupHolidays(holidays: HolidayItem[]): HolidayGroup[] {
  const sorted = [...holidays].map((h) => ({ ...h, date: toDateInput(h.date) })).sort((a, b) => a.date.localeCompare(b.date));
  const groups: HolidayGroup[] = [];
  for (const h of sorted) {
    const last = groups[groups.length - 1];
    if (
      last &&
      last.name === h.name &&
      last.academicSessionId === h.academicSessionId &&
      last.termId === h.termId &&
      isAdjacentSkippingWeekends(last.endDate, h.date)
    ) {
      last.ids.push(h.id);
      last.endDate = h.date;
    } else {
      groups.push({
        key: h.id,
        name: h.name,
        academicSessionId: h.academicSessionId,
        termId: h.termId,
        ids: [h.id],
        startDate: h.date,
        endDate: h.date,
      });
    }
  }
  return groups;
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
  const [isRange, setIsRange] = useState(false);
  const [endDate, setEndDate] = useState("");
  const [academicSessionId, setAcademicSessionId] = useState(NONE);
  const [termId, setTermId] = useState(NONE);
  const [submitting, setSubmitting] = useState(false);

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editEndDate, setEditEndDate] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  const groups = useMemo(() => groupHolidays(holidays ?? []), [holidays]);

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
      const commonBody = {
        name,
        academicSessionId: academicSessionId === NONE ? undefined : academicSessionId,
        termId: termId === NONE ? undefined : termId,
      };
      if (isRange) {
        await apiFetch("/school-holidays/range", {
          method: "POST",
          auth: true,
          body: { ...commonBody, startDate: date, endDate },
        });
      } else {
        await apiFetch("/school-holidays", { method: "POST", auth: true, body: { ...commonBody, date } });
      }
      setName("");
      setDate("");
      setEndDate("");
      setIsRange(false);
      setAcademicSessionId(NONE);
      setTermId(NONE);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(group: HolidayGroup) {
    setEditingKey(group.key);
    setEditName(group.name);
    setEditStartDate(group.startDate);
    setEditEndDate(group.endDate);
  }

  // A single-day group PATCHes its one row in place, same as before. A
  // range group has no single row to PATCH into a new shape (it may have
  // grown, shrunk, or moved), so it's replaced instead: delete every row
  // the group currently holds, then recreate via the same range endpoint
  // create() uses — the same "follow the create pattern" shape the edit
  // form itself now mirrors.
  async function saveEdit(group: HolidayGroup) {
    setError(null);
    setEditSubmitting(true);
    try {
      if (group.ids.length === 1) {
        await apiFetch(`/school-holidays/${group.ids[0]}`, {
          method: "PATCH",
          auth: true,
          body: { name: editName, date: editStartDate },
        });
      } else {
        await Promise.all(group.ids.map((id) => apiFetch(`/school-holidays/${id}`, { method: "DELETE", auth: true })));
        await apiFetch("/school-holidays/range", {
          method: "POST",
          auth: true,
          body: {
            name: editName,
            startDate: editStartDate,
            endDate: editEndDate,
            academicSessionId: group.academicSessionId ?? undefined,
            termId: group.termId ?? undefined,
          },
        });
      }
      setEditingKey(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update holiday");
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleDelete(group: HolidayGroup) {
    setError(null);
    try {
      await Promise.all(group.ids.map((id) => apiFetch(`/school-holidays/${id}`, { method: "DELETE", auth: true })));
      setDeletingKey(null);
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
        {groups.map((group) => {
          const isRangeGroup = group.ids.length > 1;
          return editingKey === group.key ? (
            <div
              key={group.key}
              className="grid grid-cols-1 items-end gap-2 rounded-lg border border-border p-2.5 sm:grid-cols-2"
            >
              <FormField label="Name" id={`holiday-edit-name-${group.key}`} value={editName} onChange={(e) => setEditName(e.target.value)} />
              <div />
              <FormField
                label={isRangeGroup ? "Start date" : "Date"}
                id={`holiday-edit-start-${group.key}`}
                type="date"
                value={editStartDate}
                onChange={(e) => setEditStartDate(e.target.value)}
              />
              {isRangeGroup && (
                <FormField
                  label="End date"
                  id={`holiday-edit-end-${group.key}`}
                  type="date"
                  value={editEndDate}
                  onChange={(e) => setEditEndDate(e.target.value)}
                />
              )}
              <div className="flex gap-2 sm:col-span-2">
                <Button type="button" size="sm" disabled={editSubmitting} onClick={() => saveEdit(group)}>
                  Save
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setEditingKey(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div key={group.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2.5 text-[12.5px]">
              <span>
                {group.name}{" "}
                <span className="font-mono text-muted">
                  ({group.startDate}
                  {isRangeGroup ? ` – ${group.endDate}` : ""})
                </span>
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button type="button" variant="outline" size="sm" onClick={() => startEdit(group)}>
                  Edit
                </Button>
                <AlertDialog open={deletingKey === group.key} onOpenChange={(open) => setDeletingKey(open ? group.key : null)}>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="outline" size="sm">
                      Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogTitle className="text-lg font-semibold">Delete {group.name}?</AlertDialogTitle>
                    <AlertDialogDescription className="mt-2 text-sm text-muted">
                      This affects the school-days-opened calculation for any term{" "}
                      {isRangeGroup ? "these dates fall" : "this date falls"} within.
                      {isRangeGroup ? ` Removes all ${group.ids.length} days in this range.` : ""} This cannot be undone.
                    </AlertDialogDescription>
                    <div className="mt-4 flex justify-end gap-2">
                      <AlertDialogCancel asChild>
                        <Button variant="outline">Cancel</Button>
                      </AlertDialogCancel>
                      <Button onClick={() => handleDelete(group)}>Confirm delete</Button>
                    </div>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          );
        })}
        {holidays?.length === 0 && <EmptyState icon={CalendarOff} title="No school holidays declared yet" className="py-6" />}
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Name" id="holiday-name" required value={name} onChange={(e) => setName(e.target.value)} />
        <div className="flex items-center gap-2 self-end pb-2.5">
          <Checkbox id="holiday-range" checked={isRange} onCheckedChange={(checked) => setIsRange(checked === true)} />
          <Label htmlFor="holiday-range" className="cursor-pointer font-normal">
            Multi-day (e.g. mid-term break) — one entry per weekday in the range
          </Label>
        </div>
        <FormField
          label={isRange ? "Start date" : "Date"}
          id="holiday-date"
          type="date"
          required
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        {isRange && (
          <FormField
            label="End date"
            id="holiday-end-date"
            type="date"
            required
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        )}
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
