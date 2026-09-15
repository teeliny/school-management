"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { FormField } from "../molecules/form-field";
import { Button } from "../atoms/button";
import { Label } from "../atoms/label";
import { MultiSelect } from "../molecules/multi-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../molecules/select";

type DayOfWeek = "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY";

const DAY_LABELS: Record<DayOfWeek, string> = {
  MONDAY: "Monday",
  TUESDAY: "Tuesday",
  WEDNESDAY: "Wednesday",
  THURSDAY: "Thursday",
  FRIDAY: "Friday",
};

interface SubjectOption {
  id: string;
  name: string;
  code: string;
}
interface StaffOption {
  id: string;
  user: { firstName: string; lastName: string };
}
interface ClassArmOption {
  id: string;
  displayName: string;
}

// PRD §3.8: manual timetable slot creation — teacher/venue double-booking
// conflicts are caught server-side; the backend's 400 message is surfaced
// verbatim via the standard error-banner convention, no separate conflict UI.
// A shared elective session (one subject/teacher taught in parallel to
// several arms at once — e.g. a combined SSS1 Diamond + Ruby options-column
// period) needs the identical slot created once per arm; `classArmIds` lets
// one submit fan out to `POST /timetable-slots` per selected arm instead of
// re-filling the form per arm. Each POST is independent (no batch endpoint),
// so a conflict in one arm doesn't block the others — same "drop the one
// that conflicts, keep the rest" precedent as the AI-generation callback.
export function TimetableSlotForm({
  defaultClassArmId,
  classArmOptions,
  academicSessionId,
  termId,
  onCreated,
}: {
  defaultClassArmId: string;
  classArmOptions: ClassArmOption[];
  academicSessionId: string;
  termId: string;
  onCreated?: () => void;
}) {
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [classArmIds, setClassArmIds] = useState<string[]>(defaultClassArmId ? [defaultClassArmId] : []);
  const [subjectId, setSubjectId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState<DayOfWeek>("MONDAY");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [venue, setVenue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiFetch<SubjectOption[]>("/subjects", { auth: true }).then(setSubjects).catch(() => setSubjects([]));
    apiFetch<StaffOption[]>("/staff-profiles", { auth: true }).then(setStaffOptions).catch(() => setStaffOptions([]));
  }, []);

  // Re-sync to the page's currently-viewed class whenever it changes —
  // otherwise a stale arm from a previously-viewed class stays selected.
  useEffect(() => {
    setClassArmIds(defaultClassArmId ? [defaultClassArmId] : []);
  }, [defaultClassArmId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    const armById = new Map(classArmOptions.map((a) => [a.id, a.displayName]));
    const failures: string[] = [];
    let succeeded = 0;
    try {
      for (const armId of classArmIds) {
        try {
          await apiFetch("/timetable-slots", {
            method: "POST",
            auth: true,
            body: {
              classArmId: armId,
              subjectId,
              staffId,
              academicSessionId,
              termId,
              dayOfWeek,
              startTime,
              endTime,
              venue: venue || undefined,
            },
          });
          succeeded += 1;
        } catch (err) {
          const message = err instanceof ApiError ? err.message : "Something went wrong";
          failures.push(`${armById.get(armId) ?? armId}: ${message}`);
        }
      }
      if (succeeded > 0) {
        setSuccess(`Slot added to ${succeeded} class${succeeded === 1 ? "" : "es"}.`);
        setSubjectId("");
        setStaffId("");
        setStartTime("");
        setEndTime("");
        setVenue("");
        onCreated?.();
      }
      if (failures.length > 0) {
        setError(failures.join("; "));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const disabled = classArmIds.length === 0 || !academicSessionId || !termId;

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
      {error && <p className="text-sm text-danger">{error}</p>}
      {success && <p className="text-sm text-success">{success}</p>}
      {disabled && <p className="text-sm text-muted">Select a class, session, and term above first.</p>}

      <div>
        <Label htmlFor="ts-class-arms">Class arm(s)</Label>
        <MultiSelect
          id="ts-class-arms"
          value={classArmIds}
          onValueChange={setClassArmIds}
          options={classArmOptions.map((a) => ({ value: a.id, label: a.displayName }))}
          placeholder="Select class arm(s)"
          className="mt-1"
        />
        {classArmIds.length > 1 && (
          <p className="mt-1 text-[11px] text-muted">
            Creates the same subject/teacher/time slot in all {classArmIds.length} selected classes — e.g. a shared
            elective period taught across several arms at once.
          </p>
        )}
      </div>

      <div>
        <Label htmlFor="ts-subject">Subject</Label>
        <Select value={subjectId} onValueChange={setSubjectId}>
          <SelectTrigger id="ts-subject" className="mt-1">
            <SelectValue placeholder="Select subject" />
          </SelectTrigger>
          <SelectContent>
            {subjects.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name} ({s.code})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="ts-staff">Teacher</Label>
        <Select value={staffId} onValueChange={setStaffId}>
          <SelectTrigger id="ts-staff" className="mt-1">
            <SelectValue placeholder="Select teacher" />
          </SelectTrigger>
          <SelectContent>
            {staffOptions.map((staff) => (
              <SelectItem key={staff.id} value={staff.id}>
                {staff.user.firstName} {staff.user.lastName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="ts-day">Day</Label>
        <Select value={dayOfWeek} onValueChange={(v) => setDayOfWeek(v as DayOfWeek)}>
          <SelectTrigger id="ts-day" className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(DAY_LABELS) as DayOfWeek[]).map((day) => (
              <SelectItem key={day} value={day}>
                {DAY_LABELS[day]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          label="Start time"
          id="ts-start-time"
          type="time"
          required
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
        />
        <FormField
          label="End time"
          id="ts-end-time"
          type="time"
          required
          value={endTime}
          onChange={(e) => setEndTime(e.target.value)}
        />
      </div>

      <FormField label="Venue (optional)" id="ts-venue" value={venue} onChange={(e) => setVenue(e.target.value)} />

      <Button type="submit" disabled={submitting || disabled} className="w-full">
        {submitting ? "Adding…" : "Add slot"}
      </Button>
    </form>
  );
}
