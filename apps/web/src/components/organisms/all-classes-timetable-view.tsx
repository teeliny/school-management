"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { categoryToGroup, DAYS_OF_WEEK, type ClassLevelCategoryGroup, type DayOfWeek } from "@school/types";
import { apiFetch, ApiError } from "../../lib/api";
import { buildPeriodColumns, resolvePeriodIndex } from "../../lib/period-columns";
import { usePeriodStructure } from "../../lib/use-period-structure";
import { Badge } from "../atoms/badge";
import { Button } from "../atoms/button";
import { ClickReveal } from "../molecules/click-reveal";

interface TimetableSlotItem {
  id: string;
  classArmId: string;
  subject: { name: string; code: string };
  staff: { user: { firstName: string; lastName: string } };
  dayOfWeek: DayOfWeek;
  startTime: string;
  venue: string | null;
  approvalStatus: "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "REJECTED";
}
interface ClassArmOption {
  id: string;
  displayName: string;
  classLevel: { category: "CRECHE" | "NURSERY" | "PRIMARY" | "JSS" | "SSS" };
}

const DAY_LABELS: Record<DayOfWeek, string> = {
  MONDAY: "Monday",
  TUESDAY: "Tuesday",
  WEDNESDAY: "Wednesday",
  THURSDAY: "Thursday",
  FRIDAY: "Friday",
};
const GROUP_LABEL: Record<ClassLevelCategoryGroup, string> = {
  JSS_SSS: "JSS / SSS",
  CRECHE_NURSERY_PRIMARY: "Creche / Nursery / Primary",
};

/**
 * BUILD_PLAN.md §9 Step 7's "whole-school timetable overview" (PRD FR6.10,
 * §5 footnote 6) — a real DAY/Class-by-period grid (one group's period
 * structure at a time, since JSS/SSS and Creche/Nursery/Primary run
 * different period counts/times), matching the hand-drawn timetable grid
 * this UI is modeled on. Read-only: this view is for oversight across every
 * class at once — editing stays in the single-class TimetableGrid, reached
 * here via each row's "Edit" link. A cell shows just the subject; the
 * teacher's name is revealed on click (ClickReveal) rather than always
 * shown, so the grid stays scannable.
 */
export function AllClassesTimetableView({
  academicSessionId,
  termId,
  onViewClass,
}: {
  academicSessionId: string;
  termId: string;
  onViewClass: (classArmId: string) => void;
}) {
  const [rows, setRows] = useState<TimetableSlotItem[] | null>(null);
  const [classArms, setClassArms] = useState<ClassArmOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<ClassLevelCategoryGroup>("JSS_SSS");
  const structure = usePeriodStructure(group);

  const load = useCallback(() => {
    if (!academicSessionId || !termId) {
      setRows(null);
      return;
    }
    const qs = `academicSessionId=${academicSessionId}&termId=${termId}`;
    Promise.allSettled([
      apiFetch<TimetableSlotItem[]>(`/timetable-slots?${qs}`, { auth: true }),
      apiFetch<TimetableSlotItem[]>(`/timetable-slots?${qs}&approvalStatus=PENDING_REVIEW`, { auth: true }),
    ]).then(([approvedR, pendingR]) => {
      if (approvedR.status === "rejected" && pendingR.status === "rejected") {
        setError(approvedR.reason instanceof ApiError ? approvedR.reason.message : "Failed to load timetable");
        return;
      }
      setError(null);
      const approved = approvedR.status === "fulfilled" ? approvedR.value : [];
      const pending = pendingR.status === "fulfilled" ? pendingR.value : [];
      setRows([...approved, ...pending]);
    });
  }, [academicSessionId, termId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!academicSessionId) {
      setClassArms([]);
      return;
    }
    apiFetch<ClassArmOption[]>(`/class-arms?academicSessionId=${academicSessionId}`, { auth: true })
      .then(setClassArms)
      .catch(() => setClassArms([]));
  }, [academicSessionId]);

  const classArmsForGroup = useMemo(
    () =>
      classArms
        .filter((arm) => categoryToGroup(arm.classLevel.category) === group)
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [classArms, group],
  );

  // O(1) cell lookup: (classArmId, day, periodIndex) -> the slot in it. A
  // slot's period index is resolved against *its own* dayOfWeek (Friday's
  // shorter break shifts which period a given startTime falls in) rather
  // than the Monday-derived column headers.
  const slotByCell = useMemo(() => {
    const map = new Map<string, TimetableSlotItem>();
    if (!rows || !structure) return map;
    for (const row of rows) {
      const periodIndex = resolvePeriodIndex(structure, row.dayOfWeek, row.startTime);
      if (periodIndex === null) continue;
      map.set(`${row.classArmId}|${row.dayOfWeek}|${periodIndex}`, row);
    }
    return map;
  }, [rows, structure]);

  const columns = useMemo(() => (structure ? buildPeriodColumns(structure) : []), [structure]);

  if (!academicSessionId || !termId) {
    return <p className="text-sm text-muted">Select a session and term to view the whole-school timetable.</p>;
  }
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!rows) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5">
        {(Object.keys(GROUP_LABEL) as ClassLevelCategoryGroup[]).map((g) => (
          <Button key={g} type="button" size="sm" variant={group === g ? "primary" : "outline"} onClick={() => setGroup(g)}>
            {GROUP_LABEL[g]}
          </Button>
        ))}
      </div>

      {classArmsForGroup.length === 0 ? (
        <p className="text-sm text-muted">No class arms in this group for the selected session.</p>
      ) : !structure ? (
        <p className="text-sm text-muted">
          This group's period structure isn't fully configured yet — set it under Constraints (PERIODS_PER_DAY,
          PERIOD_DURATION_MINUTES, SCHOOL_DAY_START_TIME, BREAK_AFTER_PERIOD, BREAK_DURATION_MINUTES,
          FRIDAY_BREAK_DURATION_MINUTES).
        </p>
      ) : (
        DAYS_OF_WEEK.map((day) => (
          <div key={day}>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">{DAY_LABELS[day]}</div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <div
                className="grid"
                style={{ gridTemplateColumns: `160px repeat(${columns.length}, minmax(78px, 1fr))` }}
              >
                <div className="border-b border-border bg-card-inset px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                  Class
                </div>
                {columns.map((col, i) => (
                  <div
                    key={i}
                    className="border-b border-border bg-card-inset px-1.5 py-1.5 text-center font-mono text-[9.5px] font-medium text-muted"
                  >
                    {col.kind === "break" ? "Break" : `${col.startTime}–${col.endTime}`}
                  </div>
                ))}

                {classArmsForGroup.map((arm) => (
                  <div key={arm.id} className="contents">
                    <div className="flex items-center justify-between gap-1.5 border-b border-border px-2 py-2 text-[12px]">
                      <span className="truncate">{arm.displayName}</span>
                      <button
                        type="button"
                        onClick={() => onViewClass(arm.id)}
                        className="flex-none text-[10.5px] text-primary underline"
                      >
                        Edit
                      </button>
                    </div>
                    {columns.map((col, i) => {
                      if (col.kind === "break") {
                        return <div key={i} className="border-b border-border bg-muted/10" />;
                      }
                      const slot = slotByCell.get(`${arm.id}|${day}|${col.index}`);
                      return (
                        <div key={i} className="border-b border-border px-1 py-1.5">
                          {slot && (
                            <ClickReveal
                              className={
                                slot.approvalStatus === "PENDING_REVIEW"
                                  ? "rounded border border-dashed border-warning px-1 py-0.5"
                                  : undefined
                              }
                              trigger={
                                <span className="truncate text-[11px] font-medium">{slot.subject.code || slot.subject.name}</span>
                              }
                            >
                              <div className="font-medium">{slot.subject.name}</div>
                              <div className="text-muted">
                                {slot.staff.user.firstName} {slot.staff.user.lastName}
                              </div>
                              {slot.venue && <div className="text-muted">{slot.venue}</div>}
                              {slot.approvalStatus === "PENDING_REVIEW" && (
                                <Badge variant="warning" className="mt-1 text-[9px]">
                                  Pending
                                </Badge>
                              )}
                            </ClickReveal>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
