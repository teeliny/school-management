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
    # "Options column" membership (ClassSubjectConcurrencyGroup) — subjects
    # sharing this id are mutually exclusive per student (e.g. SSS's
    # Physics/Financial Accounting/Literature in English), so they're
    # scheduled at the exact same (day, period) instead of each reserving
    # separate weekly capacity. None means "not part of a bundle."
    concurrencyGroupId: str | None = None


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
    groups: list[GroupPayload],
) -> dict[str, Any]:
    generated_rows: list[dict[str, Any]] = []
    for group in groups:
        rows = _solve_group(group, calculation_subjects_morning)
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
) -> list[dict[str, Any]] | None:
    model = cp_model.CpModel()
    periods = range(1, group.periodsPerDay + 1)

    staff_by_arm_subject: dict[tuple[str, str], str] = {}
    subject_by_arm_id: dict[tuple[str, str], SubjectPayload] = {}
    variables: dict[tuple[str, str, str, int], Any] = {}

    def is_open(arm_blocked: dict[str, set[int]], subject: SubjectPayload, day: str, period: int) -> bool:
        staff_blocked_raw = group.staffBlockedPeriods.get(subject.staffId, {})
        blocked_here = arm_blocked.get(day, set()) | set(staff_blocked_raw.get(day, []))
        if period in blocked_here:
            return False
        return not (calculation_subjects_morning and subject.requiresCalculation and period > group.breakAfterPeriod)

    for arm in group.classArms:
        arm_blocked = {day: set(periods_) for day, periods_ in arm.blockedPeriods.items()}
        for subject in arm.subjects:
            staff_by_arm_subject[(arm.classArmId, subject.subjectId)] = subject.staffId
            subject_by_arm_id[(arm.classArmId, subject.subjectId)] = subject

        # Group this arm's subjects by "options column" membership — an
        # ungrouped subject is its own singleton group (keyed by its own id),
        # so the same code path below covers both cases.
        groups: dict[str, list[SubjectPayload]] = {}
        for subject in arm.subjects:
            groups.setdefault(subject.concurrencyGroupId or subject.subjectId, []).append(subject)

        for group_key, members in groups.items():
            for day in group.days:
                for period in periods:
                    # A bundle only gets a slot when it's open for EVERY
                    # member (arm-blocked ∪ that member's own staff-blocked ∪
                    # the calc-morning restriction, whichever member(s)
                    # require it) — otherwise one member would end up with no
                    # variable at that slot while its bundle-mates did.
                    if not all(is_open(arm_blocked, member, day, period) for member in members):
                        continue
                    # Every member points at the SAME BoolVar object rather
                    # than each getting its own — this is what forces bundle-
                    # mates onto the identical slot with zero extra
                    # constraints: every per-subject constraint below
                    # (periodsPerWeek sum, ≤1/day, teacher conflict) already
                    # reads variables[(arm, subject, day, period)] on its own,
                    # so sharing the object keeps them all in lockstep.
                    shared_var = model.new_bool_var(f"x_{arm.classArmId}_{group_key}_{day}_{period}")
                    for member in members:
                        variables[(arm.classArmId, member.subjectId, day, period)] = shared_var

    # At most one subject (or, for a bundle, one shared slot) per class arm
    # per period — deduped by concurrencyGroupId so an N-member bundle counts
    # once rather than N times. Without the dedupe, summing the identical
    # shared variable N times would force it to always be 0 (N·v ≤ 1 with
    # boolean v means v can't be 1 once N > 1), making every bundle unusable.
    for arm in group.classArms:
        for day in group.days:
            for period in periods:
                seen_groups: set[str] = set()
                vars_here = []
                for (arm_id, subject_id, d, p), v in variables.items():
                    if arm_id != arm.classArmId or d != day or p != period:
                        continue
                    subject = subject_by_arm_id[(arm_id, subject_id)]
                    group_key = subject.concurrencyGroupId or subject_id
                    if group_key in seen_groups:
                        continue
                    seen_groups.add(group_key)
                    vars_here.append(v)
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

    # Each (arm, subject) is already capped at one occurrence/day above,
    # which is what actually spreads a calculation subject's periods across
    # the week — deliberately no additional cross-subject cap here: with
    # several calculation subjects on one arm (e.g. SSS's Math/Further
    # Maths/Physics/Chemistry/Accounting, each 3 periods/week), a "one calc
    # period per day total" cap needs more distinct calc-subject days than a
    # 5-day week has, making the model infeasible regardless of staffing.

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
