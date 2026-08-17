"use client";

import { useEffect, useState } from "react";
import type { ClassLevelCategoryGroup, PeriodStructure } from "@school/types";
import { apiFetch } from "./api";

interface ConstraintRow {
  key: string;
  value: unknown;
  classLevelCategoryGroup: ClassLevelCategoryGroup | null;
  isActive: boolean;
}

const KEYS = [
  "PERIODS_PER_DAY",
  "PERIOD_DURATION_MINUTES",
  "SCHOOL_DAY_START_TIME",
  "BREAK_AFTER_PERIOD",
  "BREAK_DURATION_MINUTES",
  "FRIDAY_BREAK_DURATION_MINUTES",
] as const;

/**
 * Resolves CLASS_TIMETABLE's six period-structure SchedulingConstraint keys
 * for one group into a `PeriodStructure` — the same shape/keys
 * apps/worker's scheduling-solve-dispatch.processor.ts resolves server-side
 * for the solver payload (`resolvePeriodStructure`), just read here directly
 * from `/scheduling-constraints` for grid rendering. `null` while loading,
 * with no group selected, or if the group's constraints aren't fully
 * configured yet.
 */
export function usePeriodStructure(group: ClassLevelCategoryGroup | null): PeriodStructure | null {
  const [structure, setStructure] = useState<PeriodStructure | null>(null);

  useEffect(() => {
    if (!group) {
      setStructure(null);
      return;
    }
    apiFetch<ConstraintRow[]>("/scheduling-constraints?scope=CLASS_TIMETABLE", { auth: true })
      .then((rows) => {
        const forGroup = rows.filter((r) => r.classLevelCategoryGroup === group && r.isActive);
        const get = (key: string) => forGroup.find((r) => r.key === key)?.value;
        if (!KEYS.every((key) => get(key) !== undefined)) {
          setStructure(null);
          return;
        }
        setStructure({
          periodsPerDay: Number(get("PERIODS_PER_DAY")),
          periodDurationMinutes: Number(get("PERIOD_DURATION_MINUTES")),
          schoolDayStartTime: String(get("SCHOOL_DAY_START_TIME")),
          breakAfterPeriod: Number(get("BREAK_AFTER_PERIOD")),
          breakDurationMinutes: Number(get("BREAK_DURATION_MINUTES")),
          fridayBreakDurationMinutes: Number(get("FRIDAY_BREAK_DURATION_MINUTES")),
        });
      })
      .catch(() => setStructure(null));
  }, [group]);

  return structure;
}
