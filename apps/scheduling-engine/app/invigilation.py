"""
BUILD_PLAN.md §9 Step 4: the CP-SAT model for `scope=INVIGILATION`.

Unlike class_timetable.py (solved per group) and exam_timetable.py (solved
per class arm, independently), this is ONE combined solve across every
targeted `ExamSchedule` row at once — staff are a shared, scarce resource
across class arms here (like class_timetable.py's teachers), so a staff
member invigilating one arm's exam is unavailable for any other arm's
overlapping exam. This is also the first scope in this phase with a real
optimization objective — BUILD_PLAN.md/PRD FR6.4 name load balancing as an
actual requirement, not just "first feasible solution" like Steps 2/3.
"""

from typing import Any

from ortools.sat.python import cp_model
from pydantic import BaseModel, Field

LEAD = "LEAD"
ASSISTANT = "ASSISTANT"
ROLES = (LEAD, ASSISTANT)

SOLVE_TIME_LIMIT_SECONDS = 20.0
# Dominates the objective so the solver always prefers a more balanced
# assignment over avoiding the soft own-subject-teacher penalty — the
# penalty only breaks ties among otherwise-equally-balanced solutions.
BALANCE_WEIGHT = 1000


class InvigilationExamPayload(BaseModel):
    examScheduleId: str
    date: str
    startTime: str
    endTime: str
    ownSubjectTeacherStaffId: str | None = None


class StaffExistingLoadPayload(BaseModel):
    totalCount: int = 0
    countByDate: dict[str, int] = Field(default_factory=dict)
    blockedRanges: list[dict[str, str]] = Field(default_factory=list)


def _time_to_minutes(t: str) -> int:
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def _ranges_overlap(a_start: str, a_end: str, b_start: str, b_end: str) -> bool:
    return _time_to_minutes(a_start) < _time_to_minutes(b_end) and _time_to_minutes(b_start) < _time_to_minutes(a_end)


def solve_invigilation(
    request_id: str,
    callback_token: str,
    max_invigilations_per_staff_per_day: int,
    hard_exclude_own_subject_teacher: bool,
    exams: list[InvigilationExamPayload],
    eligible_staff_ids: list[str],
    existing_load: dict[str, StaffExistingLoadPayload],
) -> dict[str, Any]:
    if not exams:
        return {"callbackToken": callback_token, "result": {"generatedRows": []}}

    model = cp_model.CpModel()

    def is_blocked(staff_id: str, exam: InvigilationExamPayload) -> bool:
        load = existing_load.get(staff_id)
        if not load:
            return False
        return any(
            blocked["date"] == exam.date and _ranges_overlap(exam.startTime, exam.endTime, blocked["startTime"], blocked["endTime"])
            for blocked in load.blockedRanges
        )

    # assign[(examScheduleId, staffId, role)] — skipped entirely (not
    # created) when hard-excluded (that exam's own subject teacher, JSS/SSS
    # runs only) or already blocked by an existing assignment.
    assign: dict[tuple[str, str, str], Any] = {}
    for exam in exams:
        for staff_id in eligible_staff_ids:
            if hard_exclude_own_subject_teacher and staff_id == exam.ownSubjectTeacherStaffId:
                continue
            if is_blocked(staff_id, exam):
                continue
            for role in ROLES:
                assign[(exam.examScheduleId, staff_id, role)] = model.new_bool_var(
                    f"assign_{exam.examScheduleId}_{staff_id}_{role}"
                )

    # Exactly one LEAD and one ASSISTANT per exam.
    for exam in exams:
        for role in ROLES:
            role_vars = [v for (eid, _sid, r), v in assign.items() if eid == exam.examScheduleId and r == role]
            if not role_vars:
                return {
                    "callbackToken": callback_token,
                    "error": f"No eligible invigilator available for exam {exam.examScheduleId} (requestId={request_id})",
                }
            model.add(sum(role_vars) == 1)

    # A staff member holds at most one role per exam.
    for exam in exams:
        for staff_id in eligible_staff_ids:
            pair_vars = [assign[k] for k in assign if k[0] == exam.examScheduleId and k[1] == staff_id]
            if len(pair_vars) > 1:
                model.add(sum(pair_vars) <= 1)

    def assigned_to_exam(exam_id: str, staff_id: str) -> Any:
        vars_here = [assign[k] for k in assign if k[0] == exam_id and k[1] == staff_id]
        return sum(vars_here) if vars_here else 0

    # No staff double-booked across two exams with overlapping date/time —
    # PRD FR6.4's "no staff member invigilates two concurrent exams,"
    # confirmed a real scenario since Step 3 solves each class arm
    # independently with no cross-arm time coordination.
    for i in range(len(exams)):
        for j in range(i + 1, len(exams)):
            a, b = exams[i], exams[j]
            if a.date != b.date or not _ranges_overlap(a.startTime, a.endTime, b.startTime, b.endTime):
                continue
            for staff_id in eligible_staff_ids:
                expr_a = assigned_to_exam(a.examScheduleId, staff_id)
                expr_b = assigned_to_exam(b.examScheduleId, staff_id)
                if (isinstance(expr_a, int) and expr_a == 0) or (isinstance(expr_b, int) and expr_b == 0):
                    continue
                model.add(expr_a + expr_b <= 1)

    # MAX_INVIGILATIONS_PER_STAFF_PER_DAY: new assignments that day +
    # existing count <= cap.
    exams_by_date: dict[str, list[str]] = {}
    for exam in exams:
        exams_by_date.setdefault(exam.date, []).append(exam.examScheduleId)

    for staff_id in eligible_staff_ids:
        existing = existing_load.get(staff_id)
        for date, exam_ids_that_day in exams_by_date.items():
            existing_count = existing.countByDate.get(date, 0) if existing else 0
            day_vars = [assign[k] for k in assign if k[1] == staff_id and k[0] in exam_ids_that_day]
            if day_vars:
                model.add(sum(day_vars) + existing_count <= max_invigilations_per_staff_per_day)

    # Load-balancing objective (BUILD_PLAN.md/FR6.4's stated requirement,
    # unlike Steps 2/3's "first feasible solution"): minimize the maximum
    # per-staff total (existing + new) invigilation count across the run —
    # the standard CP-SAT min-max idiom.
    total_assignable = len(exams) * 2
    max_possible_load = total_assignable + max(
        (existing_load[s].totalCount for s in eligible_staff_ids if s in existing_load), default=0
    )
    max_load = model.new_int_var(0, max(max_possible_load, 1), "max_load")
    for staff_id in eligible_staff_ids:
        existing_total = existing_load[staff_id].totalCount if staff_id in existing_load else 0
        new_vars = [v for (_eid, sid, _r), v in assign.items() if sid == staff_id]
        model.add(existing_total + sum(new_vars) <= max_load)

    # Soft own-subject-teacher avoidance — only possible at all when not
    # hard-excluded (CRECHE/NURSERY/PRIMARY runs): nudge the solver away
    # from assigning a subject's own teacher without forbidding it outright,
    # per FR6.4's soft-preference language for that group.
    soft_penalty_vars = []
    if not hard_exclude_own_subject_teacher:
        for exam in exams:
            if not exam.ownSubjectTeacherStaffId:
                continue
            soft_penalty_vars.extend(
                v for (eid, sid, _r), v in assign.items() if eid == exam.examScheduleId and sid == exam.ownSubjectTeacherStaffId
            )

    model.minimize(BALANCE_WEIGHT * max_load + sum(soft_penalty_vars))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = SOLVE_TIME_LIMIT_SECONDS
    status = solver.solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {"callbackToken": callback_token, "error": f"No feasible invigilation roster found (requestId={request_id})"}

    rows: list[dict[str, Any]] = []
    for (exam_id, staff_id, role), var in assign.items():
        if solver.value(var):
            rows.append({"examScheduleId": exam_id, "staffId": staff_id, "role": role})

    return {"callbackToken": callback_token, "result": {"generatedRows": rows}}
