"use client";

import { useEffect, useState } from "react";
import { parseSpecialPeriods, type ClassLevelCategoryGroup, type PeriodStructure, type SpecialPeriod } from "@school/types";
import { apiFetch } from "./api";

interface ConstraintRow {
  key: string;
  value: unknown;
  classLevelCategoryGroup: ClassLevelCategoryGroup | null;
  isActive: boolean;
}

// Only these six are required for a group to be considered "configured" —
// the short-break/Friday-specific/special-period keys below are all
// optional (BUILD_PLAN.md §9 Step 2 follow-up), defaulting to a no-op the
// same way apps/worker's resolvePeriodStructure does, so a group that
// hasn't opted into them still renders exactly as it did before they existed.
const KEYS = [
  "PERIODS_PER_DAY",
  "PERIOD_DURATION_MINUTES",
  "SCHOOL_DAY_START_TIME",
  "BREAK_AFTER_PERIOD",
  "BREAK_DURATION_MINUTES",
  "FRIDAY_BREAK_DURATION_MINUTES",
] as const;

/**
 * Resolves CLASS_TIMETABLE's period-structure SchedulingConstraint keys for
 * one group into a `PeriodStructure` — the same shape/keys apps/worker's
 * scheduling-solve-dispatch.processor.ts resolves server-side for the solver
 * payload (`resolvePeriodStructure`), just read here directly from
 * `/scheduling-constraints` for grid rendering. `null` while loading, with
 * no group selected, or if the group's six required constraints aren't
 * fully configured yet.
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
        const periodsPerDay = Number(get("PERIODS_PER_DAY"));
        const periodDurationMinutes = Number(get("PERIOD_DURATION_MINUTES"));
        const shortBreakAfterPeriod = get("SHORT_BREAK_AFTER_PERIOD");
        const fridayPeriodsPerDay = get("FRIDAY_PERIODS_PER_DAY");
        setStructure({
          periodsPerDay,
          periodDurationMinutes,
          schoolDayStartTime: String(get("SCHOOL_DAY_START_TIME")),
          breakAfterPeriod: Number(get("BREAK_AFTER_PERIOD")),
          breakDurationMinutes: Number(get("BREAK_DURATION_MINUTES")),
          fridayBreakDurationMinutes: Number(get("FRIDAY_BREAK_DURATION_MINUTES")),
          shortBreakAfterPeriod: shortBreakAfterPeriod === undefined ? periodsPerDay : Number(shortBreakAfterPeriod),
          shortBreakDurationMinutes: Number(get("SHORT_BREAK_DURATION_MINUTES") ?? 0),
          fridayPeriodDurationMinutes: Number(get("FRIDAY_PERIOD_DURATION_MINUTES") ?? periodDurationMinutes),
          fridayPeriodsPerDay: fridayPeriodsPerDay === undefined ? periodsPerDay : Number(fridayPeriodsPerDay),
        });
      })
      .catch(() => setStructure(null));
  }, [group]);

  return structure;
}

export interface FridayTrailingActivity {
  label: string;
  endTime: string;
}

/**
 * Grid-display-only companion to `usePeriodStructure` — SPECIAL_PERIODS
 * (fixed non-subject blocks like Wednesday Sports/Extra-Curricular) and
 * Friday's trailing-activity label/end-time. Neither affects solver
 * arithmetic (the worker already bakes SPECIAL_PERIODS into blockedPeriods
 * before dispatch, and the trailing activity is purely cosmetic — nothing
 * can be scheduled there regardless, since FRIDAY_PERIODS_PER_DAY already
 * stops the day earlier), so kept out of `PeriodStructure` itself, which
 * mirrors Python's `GroupPayload` field-for-field.
 */
export function useSpecialPeriods(group: ClassLevelCategoryGroup | null): {
  specialPeriods: SpecialPeriod[];
  fridayTrailingActivity: FridayTrailingActivity | null;
} {
  const [specialPeriods, setSpecialPeriods] = useState<SpecialPeriod[]>([]);
  const [fridayTrailingActivity, setFridayTrailingActivity] = useState<FridayTrailingActivity | null>(null);

  useEffect(() => {
    if (!group) {
      setSpecialPeriods([]);
      setFridayTrailingActivity(null);
      return;
    }
    apiFetch<ConstraintRow[]>("/scheduling-constraints?scope=CLASS_TIMETABLE", { auth: true })
      .then((rows) => {
        const forGroup = rows.filter((r) => r.classLevelCategoryGroup === group && r.isActive);
        const get = (key: string) => forGroup.find((r) => r.key === key)?.value;
        setSpecialPeriods(parseSpecialPeriods(get("SPECIAL_PERIODS")));
        const label = get("FRIDAY_TRAILING_ACTIVITY_LABEL");
        const endTime = get("FRIDAY_TRAILING_ACTIVITY_END_TIME");
        setFridayTrailingActivity(
          typeof label === "string" && typeof endTime === "string" ? { label, endTime } : null,
        );
      })
      .catch(() => {
        setSpecialPeriods([]);
        setFridayTrailingActivity(null);
      });
  }, [group]);

  return { specialPeriods, fridayTrailingActivity };
}
