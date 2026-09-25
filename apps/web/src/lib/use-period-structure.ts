"use client";

import { useEffect, useState } from "react";
import {
  findSubjectLabelSuffix,
  parseSpecialPeriods,
  parseSubjectDayPeriodRequirements,
  specialPeriodAppliesTo,
  type ClassLevelCategoryGroup,
  type DayOfWeek,
  type PeriodStructure,
  type SpecialPeriod,
  type SubjectDayPeriodRequirement,
} from "@school/types";
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
 * (fixed non-subject blocks like Wednesday Sports/Extra-Curricular),
 * EARLY_YEARS_SPECIAL_PERIODS (the NURSERY/RECEPTION-only counterpart, e.g.
 * Thursday's Textbooks block — see apps/worker's
 * resolveEarlyYearsSpecialPeriodBlocks; returned separately, not merged,
 * since a caller rendering more than one class arm at once — e.g.
 * AllClassesTimetableView — needs to apply it only to NURSERY/RECEPTION
 * rows, never to CRECHE/PRIMARY ones sharing this same group), and Friday's
 * trailing-activity label/end-time. None of these affect solver arithmetic
 * (the worker already bakes both SPECIAL_PERIODS keys into blockedPeriods
 * before dispatch, and the trailing activity is purely cosmetic — nothing
 * can be scheduled there regardless, since FRIDAY_PERIODS_PER_DAY already
 * stops the day earlier), so kept out of `PeriodStructure` itself, which
 * mirrors Python's `GroupPayload` field-for-field.
 */
export function useSpecialPeriods(group: ClassLevelCategoryGroup | null): {
  specialPeriods: SpecialPeriod[];
  earlyYearsSpecialPeriods: SpecialPeriod[];
  earlyYearsSubjectDayPeriods: SubjectDayPeriodRequirement[];
  fridayTrailingActivity: FridayTrailingActivity | null;
} {
  const [specialPeriods, setSpecialPeriods] = useState<SpecialPeriod[]>([]);
  const [earlyYearsSpecialPeriods, setEarlyYearsSpecialPeriods] = useState<SpecialPeriod[]>([]);
  const [earlyYearsSubjectDayPeriods, setEarlyYearsSubjectDayPeriods] = useState<SubjectDayPeriodRequirement[]>([]);
  const [fridayTrailingActivity, setFridayTrailingActivity] = useState<FridayTrailingActivity | null>(null);

  useEffect(() => {
    if (!group) {
      setSpecialPeriods([]);
      setEarlyYearsSpecialPeriods([]);
      setEarlyYearsSubjectDayPeriods([]);
      setFridayTrailingActivity(null);
      return;
    }
    apiFetch<ConstraintRow[]>("/scheduling-constraints?scope=CLASS_TIMETABLE", { auth: true })
      .then((rows) => {
        const forGroup = rows.filter((r) => r.classLevelCategoryGroup === group && r.isActive);
        const get = (key: string) => forGroup.find((r) => r.key === key)?.value;
        setSpecialPeriods(parseSpecialPeriods(get("SPECIAL_PERIODS")));
        setEarlyYearsSpecialPeriods(parseSpecialPeriods(get("EARLY_YEARS_SPECIAL_PERIODS")));
        setEarlyYearsSubjectDayPeriods(parseSubjectDayPeriodRequirements(get("EARLY_YEARS_SUBJECT_DAY_PERIODS")));
        const label = get("FRIDAY_TRAILING_ACTIVITY_LABEL");
        const endTime = get("FRIDAY_TRAILING_ACTIVITY_END_TIME");
        setFridayTrailingActivity(
          typeof label === "string" && typeof endTime === "string" ? { label, endTime } : null,
        );
      })
      .catch(() => {
        setSpecialPeriods([]);
        setEarlyYearsSpecialPeriods([]);
        setEarlyYearsSubjectDayPeriods([]);
        setFridayTrailingActivity(null);
      });
  }, [group]);

  return { specialPeriods, earlyYearsSpecialPeriods, earlyYearsSubjectDayPeriods, fridayTrailingActivity };
}

interface ArmClassLevel {
  name: string;
  category: "CRECHE" | "RECEPTION" | "NURSERY" | "PRIMARY" | "JSS" | "SSS";
}

function isEarlyYears(classLevel: ArmClassLevel): boolean {
  return classLevel.category === "NURSERY" || classLevel.category === "RECEPTION";
}

/**
 * The special periods that actually apply to one arm — EARLY_YEARS_SPECIAL_PERIODS
 * only for NURSERY/RECEPTION, and "@ClassLevel,..."-scoped entries only for
 * the ClassLevels they name. Same rule as apps/worker's per-arm blockedPeriods.
 */
export function specialPeriodsForArm(
  specialPeriods: SpecialPeriod[],
  earlyYearsSpecialPeriods: SpecialPeriod[],
  classLevel: ArmClassLevel,
): SpecialPeriod[] {
  return [...specialPeriods, ...(isEarlyYears(classLevel) ? earlyYearsSpecialPeriods : [])].filter((s) =>
    specialPeriodAppliesTo(s, classLevel.name),
  );
}

/** A slot's display name, with its EARLY_YEARS_SUBJECT_DAY_PERIODS suffix (e.g. "Literacy Textbook") appended where one applies. */
export function slotSubjectLabel(
  subjectLabel: string,
  subjectName: string,
  requirements: SubjectDayPeriodRequirement[],
  classLevel: ArmClassLevel,
  day: DayOfWeek,
  periodIndex: number,
): string {
  if (!isEarlyYears(classLevel)) return subjectLabel;
  const suffix = findSubjectLabelSuffix(requirements, subjectName, day, periodIndex);
  return suffix ? `${subjectLabel} ${suffix}` : subjectLabel;
}
