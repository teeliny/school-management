"""
BUILD_PLAN.md §9 Step 3: the CP-SAT model for `scope=EXAM_TIMETABLE`.

Simpler than class_timetable.py in two ways, both discovered from PRD's
`ExamSchedule` field list: there's no `staffId` (a subject's own teacher
isn't tied to when their students sit the exam — that's invigilation, Step
4, a separate staff pool), and there's no shared resource across class arms
(no teacher, no venue catalog), so each class arm's exam schedule is solved
**independently** here — unlike class_timetable.py's per-group solve.
"""

from typing import Any

from ortools.sat.python import cp_model
from pydantic import BaseModel, Field


class ExamSubjectPayload(BaseModel):
    subjectId: str
    requiresCalculation: bool


class ExistingLoadPayload(BaseModel):
    count: int
    hasCalc: bool


class ExamClassArmPayload(BaseModel):
    classArmId: str
    subjects: list[ExamSubjectPayload]
    existingByDate: dict[str, ExistingLoadPayload] = Field(default_factory=dict)


SOLVE_TIME_LIMIT_SECONDS = 20.0


def solve_exam_timetable(
    request_id: str,
    callback_token: str,
    days: list[str],
    exam_day_start_time: str,
    max_subjects_per_day: int,
    calculation_subject_duration_minutes: int,
    non_calculation_subject_duration_minutes: int,
    spread_calculation_subjects: bool,
    min_gap_between_calculation_exams_days: int,
    class_arms: list[ExamClassArmPayload],
) -> dict[str, Any]:
    generated_rows: list[dict[str, Any]] = []
    for arm in class_arms:
        rows = _solve_class_arm(
            arm,
            days,
            exam_day_start_time,
            max_subjects_per_day,
            calculation_subject_duration_minutes,
            non_calculation_subject_duration_minutes,
            spread_calculation_subjects,
            min_gap_between_calculation_exams_days,
        )
        if rows is None:
            return {
                "callbackToken": callback_token,
                "error": f"No feasible exam timetable found for class arm {arm.classArmId} (requestId={request_id})",
            }
        generated_rows.extend(rows)

    return {"callbackToken": callback_token, "result": {"generatedRows": generated_rows}}


def _solve_class_arm(
    arm: ExamClassArmPayload,
    days: list[str],
    exam_day_start_time: str,
    max_subjects_per_day: int,
    calc_duration: int,
    non_calc_duration: int,
    spread_calc: bool,
    min_gap: int,
) -> list[dict[str, Any]] | None:
    model = cp_model.CpModel()
    day_count = len(days)

    existing_calc_day_indices = {
        i for i, d in enumerate(days) if (existing := arm.existingByDate.get(d)) and existing.hasCalc
    }

    # Days a NEW calculation subject can't land on because they fall within
    # min_gap of an existing calculation-subject exam date (measured in
    # exam-day-list positions, not raw calendar days — weekends already
    # aren't in `days` at all, so they shouldn't count toward the gap).
    blocked_calc_days: set[int] = set()
    if min_gap > 0:
        for i in range(day_count):
            for existing_idx in existing_calc_day_indices:
                if abs(i - existing_idx) < min_gap:
                    blocked_calc_days.add(i)

    assign: dict[tuple[str, int], Any] = {}
    for subject in arm.subjects:
        for day_idx in range(day_count):
            if subject.requiresCalculation and day_idx in blocked_calc_days:
                continue
            assign[(subject.subjectId, day_idx)] = model.new_bool_var(f"assign_{subject.subjectId}_{day_idx}")

    # Exactly one day per subject — the whole exam period, not per-week
    # (unlike class_timetable.py's periodsPerWeek repetition).
    for subject in arm.subjects:
        subject_vars = [v for (sid, _d), v in assign.items() if sid == subject.subjectId]
        if not subject_vars:
            # No open day exists for this subject at all (e.g. every day is
            # gap-blocked) — fail fast rather than build a doomed model.
            return None
        model.add(sum(subject_vars) == 1)

    # Daily capacity: existing load + new assignments <= max_subjects_per_day.
    for day_idx, day in enumerate(days):
        existing = arm.existingByDate.get(day)
        existing_count = existing.count if existing else 0
        day_vars = [v for (_sid, d), v in assign.items() if d == day_idx]
        if day_vars:
            model.add(sum(day_vars) + existing_count <= max_subjects_per_day)

    # SPREAD_CALCULATION_SUBJECTS: at most one calculation-subject exam per
    # day, counting existing load too.
    if spread_calc:
        calc_subject_ids = {s.subjectId for s in arm.subjects if s.requiresCalculation}
        for day_idx, day in enumerate(days):
            existing = arm.existingByDate.get(day)
            existing_has_calc = 1 if existing and existing.hasCalc else 0
            day_calc_vars = [v for (sid, d), v in assign.items() if d == day_idx and sid in calc_subject_ids]
            if day_calc_vars:
                model.add(sum(day_calc_vars) + existing_has_calc <= 1)

    # MIN_GAP_BETWEEN_CALCULATION_EXAMS_DAYS between every pair of NEW
    # calculation subjects — day_of[s] is a linear expression (no separate
    # IntVar needed), gap enforced via the standard CP-SAT disjunctive-order
    # idiom (a boolean "i-before-j" variable gating two one-directional
    # inequalities), same technique class as class_timetable.py's teacher
    # no-double-booking handling.
    calc_subject_ids_list = [s.subjectId for s in arm.subjects if s.requiresCalculation]
    if min_gap > 0 and len(calc_subject_ids_list) > 1:
        day_of: dict[str, Any] = {}
        for sid in calc_subject_ids_list:
            terms = [day_idx * v for (s, day_idx), v in assign.items() if s == sid]
            if terms:
                day_of[sid] = sum(terms)
        ids_with_var = list(day_of.keys())
        for i in range(len(ids_with_var)):
            for j in range(i + 1, len(ids_with_var)):
                a, b = ids_with_var[i], ids_with_var[j]
                before = model.new_bool_var(f"before_{a}_{b}")
                model.add(day_of[b] - day_of[a] >= min_gap).only_enforce_if(before)
                model.add(day_of[a] - day_of[b] >= min_gap).only_enforce_if(before.Not())

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = SOLVE_TIME_LIMIT_SECONDS
    # First feasible solution only, same "usable draft" bar as class_timetable.py.
    status = solver.solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None

    subjects_by_day: dict[int, list[ExamSubjectPayload]] = {i: [] for i in range(day_count)}
    subject_by_id = {s.subjectId: s for s in arm.subjects}
    for (sid, day_idx), var in assign.items():
        if solver.value(var):
            subjects_by_day[day_idx].append(subject_by_id[sid])

    rows: list[dict[str, Any]] = []
    for day_idx, day in enumerate(days):
        day_subjects = subjects_by_day[day_idx]
        if not day_subjects:
            continue
        # Calculation subject(s) first (FR6.3's "earliest slot"), remaining
        # non-calculation subjects in stable order — no break gap, unlike
        # class_timetable.py's period grid (nothing suggests exam days pause
        # for recess).
        ordered = sorted(day_subjects, key=lambda s: 0 if s.requiresCalculation else 1)
        start_hour, start_minute = (int(part) for part in exam_day_start_time.split(":"))
        cursor_minutes = start_hour * 60 + start_minute
        for subject in ordered:
            duration = calc_duration if subject.requiresCalculation else non_calc_duration
            rows.append(
                {
                    "classArmId": arm.classArmId,
                    "subjectId": subject.subjectId,
                    "date": day,
                    "startTime": _minutes_to_time(cursor_minutes),
                    "endTime": _minutes_to_time(cursor_minutes + duration),
                }
            )
            cursor_minutes += duration

    return rows


def _minutes_to_time(total_minutes: int) -> str:
    hours = (total_minutes // 60) % 24
    minutes = total_minutes % 60
    return f"{hours:02d}:{minutes:02d}"
