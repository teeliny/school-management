"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { FormField } from "../molecules/form-field";
import { Button } from "../atoms/button";
import { Label } from "../atoms/label";
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

// PRD §3.8: manual timetable slot creation — teacher/venue double-booking
// conflicts are caught server-side; the backend's 400 message is surfaced
// verbatim via the standard error-banner convention, no separate conflict UI.
export function TimetableSlotForm({
  classArmId,
  academicSessionId,
  termId,
  onCreated,
}: {
  classArmId: string;
  academicSessionId: string;
  termId: string;
  onCreated?: () => void;
}) {
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await apiFetch("/timetable-slots", {
        method: "POST",
        auth: true,
        body: {
          classArmId,
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
      setSuccess("Slot added.");
      setSubjectId("");
      setStaffId("");
      setStartTime("");
      setEndTime("");
      setVenue("");
      onCreated?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  const disabled = !classArmId || !academicSessionId || !termId;

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
      {error && <p className="text-sm text-danger">{error}</p>}
      {success && <p className="text-sm text-success">{success}</p>}
      {disabled && <p className="text-sm text-muted">Select a class, session, and term above first.</p>}

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

      <div className="grid grid-cols-2 gap-4">
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
