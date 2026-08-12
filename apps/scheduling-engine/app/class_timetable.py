"""
BUILD_PLAN.md §9 Step 2: the real CP-SAT model for `scope=CLASS_TIMETABLE`.

This service holds no DB credentials (ARCHITECTURE.md §9), so apps/worker's
SchedulingSolveDispatchProcessor pre-resolves everything needed into the
payload: per-group period structure, each class arm's required subjects
(with their assigned teacher and weekly frequency), and which periods are
already blocked (by an existing TimetableSlot) per class arm and per staff
member. This module's only job is the pure combinatorial assignment problem
plus converting each assigned (day, period) into an actual clock time.
"""

from typing import Any

from ortools.sat.python import cp_model
from pydantic import BaseModel


class SubjectPayload(BaseModel):
    subjectId: str
    staffId: str
    periodsPerWeek: int
    requiresCalculation: bool


class ClassArmPayload(BaseModel):
    classArmId: str
    subjects: list[SubjectPayload]
    blockedPeriods: dict[str, list[int]]


class GroupPayload(BaseModel):
    group: str
    periodsPerDay: int
    periodDurationMinutes: int
    schoolDayStartTime: str
    breakAfterPeriod: int
    breakDurationMinutes: int
    fridayBreakDurationMinutes: int
    days: list[str]
    classArms: list[ClassArmPayload]
    staffBlockedPeriods: dict[str, dict[str, list[int]]]


SOLVE_TIME_LIMIT_SECONDS = 20.0


def solve_class_timetable(
    request_id: str,
    callback_token: str,
    calculation_subjects_morning: bool,
    spread_calculation_subjects: bool,
    groups: list[GroupPayload],
) -> dict[str, Any]:
    generated_rows: list[dict[str, Any]] = []
    for group in groups:
        rows = _solve_group(group, calculation_subjects_morning, spread_calculation_subjects)
        if rows is None:
            return {
                "callbackToken": callback_token,
                "error": f"No feasible class timetable found for group {group.group} (requestId={request_id})",
            }
        generated_rows.extend(rows)

    return {"callbackToken": callback_token, "result": {"generatedRows": generated_rows}}


def _solve_group(
    group: GroupPayload,
    calculation_subjects_morning: bool,
    spread_calculation_subjects: bool,
) -> list[dict[str, Any]] | None:
    model = cp_model.CpModel()
    periods = range(1, group.periodsPerDay + 1)

    staff_by_arm_subject: dict[tuple[str, str], str] = {}
    variables: dict[tuple[str, str, str, int], Any] = {}

    for arm in group.classArms:
        arm_blocked = {day: set(periods_) for day, periods_ in arm.blockedPeriods.items()}
        for subject in arm.subjects:
            staff_by_arm_subject[(arm.classArmId, subject.subjectId)] = subject.staffId
            staff_blocked_raw = group.staffBlockedPeriods.get(subject.staffId, {})
            staff_blocked = {day: set(periods_) for day, periods_ in staff_blocked_raw.items()}

            for day in group.days:
                blocked_here = arm_blocked.get(day, set()) | staff_blocked.get(day, set())
                for period in periods:
                    if period in blocked_here:
                        continue
                    if (
                        calculation_subjects_morning
                        and subject.requiresCalculation
                        and period > group.breakAfterPeriod
                    ):
                        continue
                    key = (arm.classArmId, subject.subjectId, day, period)
                    variables[key] = model.new_bool_var(f"x_{arm.classArmId}_{subject.subjectId}_{day}_{period}")

    # At most one subject per class arm per period.
    for arm in group.classArms:
        for day in group.days:
            for period in periods:
                vars_here = [
                    v for (arm_id, _subject_id, d, p), v in variables.items() if arm_id == arm.classArmId and d == day and p == period
                ]
                if vars_here:
                    model.add(sum(vars_here) <= 1)

    # Exactly periodsPerWeek occurrences, at most once/day, per (arm, subject).
    for arm in group.classArms:
        for subject in arm.subjects:
            subject_vars = [
                v for (arm_id, subject_id, _d, _p), v in variables.items() if arm_id == arm.classArmId and subject_id == subject.subjectId
            ]
            if len(subject_vars) < subject.periodsPerWeek:
                # Not enough open (unblocked, in-window) slots exist even in
                # principle — fail fast rather than build a model already
                # known to be infeasible.
                return None
            model.add(sum(subject_vars) == subject.periodsPerWeek)

            for day in group.days:
                day_vars = [
                    v
                    for (arm_id, subject_id, d, _p), v in variables.items()
                    if arm_id == arm.classArmId and subject_id == subject.subjectId and d == day
                ]
                if day_vars:
                    model.add(sum(day_vars) <= 1)

    # No teacher double-booked across class arms within this solve.
    staff_keys: dict[str, list[tuple[str, str]]] = {}
    for (arm_id, subject_id), staff_id in staff_by_arm_subject.items():
        staff_keys.setdefault(staff_id, []).append((arm_id, subject_id))
    for arm_subject_pairs in staff_keys.values():
        if len(arm_subject_pairs) < 2:
            continue
        for day in group.days:
            for period in periods:
                vars_here = [
                    variables[(arm_id, subject_id, day, period)]
                    for (arm_id, subject_id) in arm_subject_pairs
                    if (arm_id, subject_id, day, period) in variables
                ]
                if len(vars_here) > 1:
                    model.add(sum(vars_here) <= 1)

    # SPREAD_CALCULATION_SUBJECTS: at most one calculation-subject period per
    # class arm per day, across all calculation subjects combined.
    if spread_calculation_subjects:
        for arm in group.classArms:
            calc_subject_ids = {s.subjectId for s in arm.subjects if s.requiresCalculation}
            if not calc_subject_ids:
                continue
            for day in group.days:
                vars_here = [
                    v
                    for (arm_id, subject_id, d, _p), v in variables.items()
                    if arm_id == arm.classArmId and subject_id in calc_subject_ids and d == day
                ]
                if vars_here:
                    model.add(sum(vars_here) <= 1)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = SOLVE_TIME_LIMIT_SECONDS
    # First feasible solution only (BUILD_PLAN.md §9: "a usable draft ...
    # requiring only minor manual edits", not a globally-optimized
    # timetable) — no objective function set.
    status = solver.solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None

    rows: list[dict[str, Any]] = []
    for (arm_id, subject_id, day, period), var in variables.items():
        if solver.value(var):
            start_time, end_time = _compute_period_time(group, day, period)
            rows.append(
                {
                    "classArmId": arm_id,
                    "subjectId": subject_id,
                    "staffId": staff_by_arm_subject[(arm_id, subject_id)],
                    "dayOfWeek": day,
                    "startTime": start_time,
                    "endTime": end_time,
                }
            )
    return rows


def _compute_period_time(group: GroupPayload, day: str, period_index: int) -> tuple[str, str]:
    """
    Mirrors packages/types/src/scheduling.ts's `computePeriodTime` — same
    arithmetic, computed independently here from the same seed values
    (periodsPerDay/duration/start-time/break, all in this group's payload)
    rather than shared across the language boundary. Only worker-side
    blocked-period computation uses the TypeScript version; this is what
    actually determines the persisted TimetableSlot.startTime/endTime.
    """
    start_hour, start_minute = (int(part) for part in group.schoolDayStartTime.split(":"))
    day_start_minutes = start_hour * 60 + start_minute
    break_minutes = group.fridayBreakDurationMinutes if day == "FRIDAY" else group.breakDurationMinutes

    period_start_minutes = day_start_minutes + (period_index - 1) * group.periodDurationMinutes
    if period_index > group.breakAfterPeriod:
        period_start_minutes += break_minutes
    period_end_minutes = period_start_minutes + group.periodDurationMinutes

    return _minutes_to_time(period_start_minutes), _minutes_to_time(period_end_minutes)


def _minutes_to_time(total_minutes: int) -> str:
    hours = (total_minutes // 60) % 24
    minutes = total_minutes % 60
    return f"{hours:02d}:{minutes:02d}"
