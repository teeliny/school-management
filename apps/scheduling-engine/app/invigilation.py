"""
BUILD_PLAN.md §9 Step 4: the model for `scope=INVIGILATION`.

Three modes, one per exam arrangement (examArrangementFor in packages/types,
resolved by apps/worker — this service only ever sees the mode it's told):

- CLASS_TEACHER (Reception/Nursery, and Basic mid-term): every paper a class
  arm sits is supervised by that arm's own class teacher(s) — first = LEAD,
  second (if any) = ASSISTANT. Deterministic, no CP-SAT model needed.
- ONE_PER_ARM_PER_DAY (JSS/SSS mid-term): one teacher per class arm per exam
  day, covering every paper that arm sits that day (LEAD on each of them).
  A teacher covers at most one arm per day, never an arm on a day it sits one
  of the teacher's own subjects (FR6.4's JSS/SSS hard exclusion), and isn't
  already invigilating elsewhere that day. Load-balanced.
- HALL_POOL_PER_DAY (JSS/SSS exam, Basic exam — mixed halls): exactly N
  invigilators per exam day for the whole sitting, not tied to any paper.
  Load-balanced; a teacher whose own subject is being written that day is
  avoided where possible (soft — a hall sits every subject over the period,
  so a hard rule would rule out nearly everyone on busy days).

Staff are a shared, scarce resource across arms/days, so modes 2 and 3 are
each ONE combined solve, minimizing the maximum per-staff load (existing
load from earlier runs included), same min-max idiom as before.
"""

from typing import Any

from ortools.sat.python import cp_model
from pydantic import BaseModel, Field

CLASS_TEACHER = "CLASS_TEACHER"
ONE_PER_ARM_PER_DAY = "ONE_PER_ARM_PER_DAY"
HALL_POOL_PER_DAY = "HALL_POOL_PER_DAY"

SOLVE_TIME_LIMIT_SECONDS = 20.0
# Dominates the objective so the solver always prefers a more balanced
# assignment over avoiding the soft own-subject-teacher penalty — the
# penalty only breaks ties among otherwise-equally-balanced solutions.
BALANCE_WEIGHT = 1000


class InvigilationExamPayload(BaseModel):
    examScheduleId: str
    classArmId: str
    date: str
    startTime: str
    endTime: str
    ownSubjectTeacherStaffId: str | None = None
    # CLASS_TEACHER mode only — the arm's active class teachers, in a stable order.
    classTeacherStaffIds: list[str] = Field(default_factory=list)


class StaffExistingLoadPayload(BaseModel):
    totalCount: int = 0
    # Dates the staff member is already invigilating anything (any earlier,
    # non-rejected run) — blocked outright for the per-day modes, since both
    # occupy the whole exam day.
    busyDates: list[str] = Field(default_factory=list)


def solve_invigilation(
    request_id: str,
    callback_token: str,
    mode: str,
    exams: list[InvigilationExamPayload],
    eligible_staff_ids: list[str],
    existing_load: dict[str, StaffExistingLoadPayload],
    invigilators_per_day: int = 2,
) -> dict[str, Any]:
    if not exams:
        return {"callbackToken": callback_token, "result": {"generatedRows": []}}

    if mode == CLASS_TEACHER:
        result = _solve_class_teacher(exams)
    elif mode == ONE_PER_ARM_PER_DAY:
        result = _solve_one_per_arm_per_day(exams, eligible_staff_ids, existing_load)
    elif mode == HALL_POOL_PER_DAY:
        result = _solve_hall_pool(exams, eligible_staff_ids, existing_load, invigilators_per_day)
    else:
        result = f"Unknown invigilation mode {mode!r}"

    if isinstance(result, str):
        return {"callbackToken": callback_token, "error": f"{result} (requestId={request_id})"}
    return {"callbackToken": callback_token, "result": {"generatedRows": result}}


def _solve_class_teacher(exams: list[InvigilationExamPayload]) -> list[dict[str, Any]] | str:
    rows: list[dict[str, Any]] = []
    missing_arms: set[str] = set()
    for exam in exams:
        if not exam.classTeacherStaffIds:
            missing_arms.add(exam.classArmId)
            continue
        rows.append({"examScheduleId": exam.examScheduleId, "staffId": exam.classTeacherStaffIds[0], "role": "LEAD"})
        if len(exam.classTeacherStaffIds) > 1:
            rows.append({"examScheduleId": exam.examScheduleId, "staffId": exam.classTeacherStaffIds[1], "role": "ASSISTANT"})
    if missing_arms:
        return f"No active class teacher for class arm(s) {', '.join(sorted(missing_arms))} — assign one first"
    return rows


def _busy(existing_load: dict[str, StaffExistingLoadPayload], staff_id: str, date: str) -> bool:
    load = existing_load.get(staff_id)
    return bool(load and date in load.busyDates)


def _existing_total(existing_load: dict[str, StaffExistingLoadPayload], staff_id: str) -> int:
    load = existing_load.get(staff_id)
    return load.totalCount if load else 0


def _solve_one_per_arm_per_day(
    exams: list[InvigilationExamPayload],
    eligible_staff_ids: list[str],
    existing_load: dict[str, StaffExistingLoadPayload],
) -> list[dict[str, Any]] | str:
    # (classArmId, date) -> that arm's papers that day.
    arm_days: dict[tuple[str, str], list[InvigilationExamPayload]] = {}
    for exam in exams:
        arm_days.setdefault((exam.classArmId, exam.date), []).append(exam)

    model = cp_model.CpModel()
    assign: dict[tuple[tuple[str, str], str], Any] = {}
    for key, day_exams in arm_days.items():
        _arm, date = key
        own_teachers = {e.ownSubjectTeacherStaffId for e in day_exams if e.ownSubjectTeacherStaffId}
        candidates = [s for s in eligible_staff_ids if s not in own_teachers and not _busy(existing_load, s, date)]
        if not candidates:
            return f"No eligible invigilator for class arm {key[0]} on {date} (everyone teaches one of that day's subjects or is already on duty)"
        for staff_id in candidates:
            assign[(key, staff_id)] = model.new_bool_var(f"a_{key[0]}_{date}_{staff_id}")
        model.add(sum(assign[(key, s)] for s in candidates) == 1)

    # One arm per teacher per day.
    dates = {d for (_a, d) in arm_days}
    for staff_id in eligible_staff_ids:
        for date in dates:
            day_vars = [v for ((arm_key, sid), v) in assign.items() if sid == staff_id and arm_key[1] == date]
            if len(day_vars) > 1:
                model.add(sum(day_vars) <= 1)

    max_load = model.new_int_var(0, len(arm_days) + max((_existing_total(existing_load, s) for s in eligible_staff_ids), default=0), "max_load")
    for staff_id in eligible_staff_ids:
        new_vars = [v for ((_k, sid), v) in assign.items() if sid == staff_id]
        if new_vars:
            model.add(_existing_total(existing_load, staff_id) + sum(new_vars) <= max_load)
    model.minimize(max_load)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = SOLVE_TIME_LIMIT_SECONDS
    status = solver.solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return "No feasible invigilation roster found — too few eligible teachers for the class arms sitting each day"

    rows: list[dict[str, Any]] = []
    for (key, staff_id), var in assign.items():
        if solver.value(var):
            for exam in arm_days[key]:
                rows.append({"examScheduleId": exam.examScheduleId, "staffId": staff_id, "role": "LEAD"})
    return rows


def _solve_hall_pool(
    exams: list[InvigilationExamPayload],
    eligible_staff_ids: list[str],
    existing_load: dict[str, StaffExistingLoadPayload],
    invigilators_per_day: int,
) -> list[dict[str, Any]] | str:
    if invigilators_per_day < 1:
        return "Invigilators per day must be at least 1"

    own_teachers_by_date: dict[str, set[str]] = {}
    for exam in exams:
        own = own_teachers_by_date.setdefault(exam.date, set())
        if exam.ownSubjectTeacherStaffId:
            own.add(exam.ownSubjectTeacherStaffId)
    dates = sorted(own_teachers_by_date)

    model = cp_model.CpModel()
    assign: dict[tuple[str, str], Any] = {}
    soft_penalty_vars = []
    for date in dates:
        candidates = [s for s in eligible_staff_ids if not _busy(existing_load, s, date)]
        if len(candidates) < invigilators_per_day:
            return f"Only {len(candidates)} eligible invigilator(s) free on {date}, but {invigilators_per_day} are required per day"
        for staff_id in candidates:
            var = model.new_bool_var(f"h_{date}_{staff_id}")
            assign[(date, staff_id)] = var
            if staff_id in own_teachers_by_date[date]:
                soft_penalty_vars.append(var)
        model.add(sum(assign[(date, s)] for s in candidates) == invigilators_per_day)

    max_load = model.new_int_var(0, len(dates) + max((_existing_total(existing_load, s) for s in eligible_staff_ids), default=0), "max_load")
    for staff_id in eligible_staff_ids:
        new_vars = [v for ((_d, sid), v) in assign.items() if sid == staff_id]
        if new_vars:
            model.add(_existing_total(existing_load, staff_id) + sum(new_vars) <= max_load)
    model.minimize(BALANCE_WEIGHT * max_load + sum(soft_penalty_vars))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = SOLVE_TIME_LIMIT_SECONDS
    status = solver.solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return "No feasible hall invigilation roster found"

    return [{"date": date, "staffId": staff_id} for (date, staff_id), var in assign.items() if solver.value(var)]
