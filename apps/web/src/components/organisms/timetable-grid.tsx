"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";

interface TimetableSlotItem {
  id: string;
  dayOfWeek: "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY";
  startTime: string;
  endTime: string;
  venue: string | null;
  subject: { name: string; code: string };
  staff: { user: { firstName: string; lastName: string } };
}

const DAYS: TimetableSlotItem["dayOfWeek"][] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];
const DAY_LABELS: Record<TimetableSlotItem["dayOfWeek"], string> = {
  MONDAY: "Mon",
  TUESDAY: "Tue",
  WEDNESDAY: "Wed",
  THURSDAY: "Thu",
  FRIDAY: "Fri",
};

// Mon–Fri x period grid for one class arm/session/term — the one genuinely
// new visual pattern in Phase 3's frontend (everything else reuses existing
// list/form shapes).
export function TimetableGrid({
  classArmId,
  academicSessionId,
  termId,
  refreshKey,
}: {
  classArmId: string;
  academicSessionId: string;
  termId: string;
  refreshKey?: unknown;
}) {
  const [slots, setSlots] = useState<TimetableSlotItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!classArmId || !academicSessionId || !termId) {
      setSlots(null);
      return;
    }
    apiFetch<TimetableSlotItem[]>(
      `/timetable-slots?classArmId=${classArmId}&academicSessionId=${academicSessionId}&termId=${termId}`,
      { auth: true },
    )
      .then(setSlots)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load timetable"));
  }, [classArmId, academicSessionId, termId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (!classArmId || !academicSessionId || !termId) {
    return <p className="text-sm text-muted">Select a class, session, and term to view its timetable.</p>;
  }
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!slots) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="grid grid-cols-5 gap-2 max-h-[420px] overflow-auto">
      {DAYS.map((day) => {
        const daySlots = slots
          .filter((s) => s.dayOfWeek === day)
          .sort((a, b) => a.startTime.localeCompare(b.startTime));
        return (
          <div key={day} className="min-w-[150px] space-y-2">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted">{DAY_LABELS[day]}</div>
            {daySlots.length === 0 && <p className="text-[11px] text-muted">—</p>}
            {daySlots.map((slot) => (
              <div key={slot.id} className="rounded-lg border border-border bg-card-inset p-2 text-[11.5px]">
                <div className="font-mono text-muted">
                  {slot.startTime}–{slot.endTime}
                </div>
                <div className="font-medium">{slot.subject.name}</div>
                <div className="text-muted">
                  {slot.staff.user.firstName} {slot.staff.user.lastName}
                </div>
                {slot.venue && <div className="text-muted">{slot.venue}</div>}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
