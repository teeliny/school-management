"""
BUILD_PLAN.md §9 Step 5: the CP-SAT model for `scope=WEEKLY_DUTY`.

Solved per ClassLevelCategoryGroup independently (a run may cover one or
both groups at once, FR6.11) — the two groups' staff pools are always
disjoint, same reasoning as class_timetable.py's per-group solve. Unlike
invigilation.py's hard own-subject-teacher exclusion, the minimum-gap rule
here (MIN_WEEKS_BETWEEN_REPEAT_DUTY) is entirely SOFT per your Step 5
decision — PRD's "unless the eligible pool is too small to avoid it"
language means the solver should prefer spacing duty turns apart but must
still produce a full roster when it can't. Load balancing (minimizing the
max total duty-weeks any one staff member accumulates) is a secondary
objective term, dominated by gap-violation minimization.
"""

from typing import Any

from ortools.sat.python import cp_model
from pydantic import BaseModel, Field

SOLVE_TIME_LIMIT_SECONDS = 20.0
# Gap-violation minimization always wins first; load balancing only breaks
# ties among equally-violation-minimal solutions — same dominance-ordering
# technique as invigilation.py's BALANCE_WEIGHT * max_load + soft_penalty_sum.
GAP_VIOLATION_WEIGHT = 100_000
BALANCE_WEIGHT = 1


class WeeklyDutyGroupPayload(BaseModel):
    classLevelCategoryGroup: str
    weeks: list[str] = Field(default_factory=list)
    teachersPerWeek: int
    minWeeksBetweenRepeatDuty: int
    eligibleStaffIds: list[str] = Field(default_factory=list)
    # staffId -> "YYYY-MM-DD" of their most recent pre-term duty week, if any
    # falls within the lookback window.
    recentDutyByStaff: dict[str, str] = Field(default_factory=dict)


def _week_gap(a: str, b: str) -> int:
    from datetime import date

    return abs((date.fromisoformat(a) - date.fromisoformat(b)).days) // 7


def _solve_group(request_id: str, group: WeeklyDutyGroupPayload) -> dict[str, Any] | list[dict[str, Any]]:
    if not group.weeks:
        return []

    if len(group.eligibleStaffIds) < group.teachersPerWeek:
        return {
            "error": (
                f"Eligible staff pool ({len(group.eligibleStaffIds)}) for "
                f"{group.classLevelCategoryGroup} is smaller than teachersPerWeek "
                f"({group.teachersPerWeek}) (requestId={request_id})"
            )
        }

    model = cp_model.CpModel()

    # assign[(staffId, weekIndex)] — no variables are skipped: the gap rule
    # is soft, not a hard block, so every staff/week pairing stays eligible.
    assign: dict[tuple[str, int], Any] = {
        (staff_id, week_index): model.new_bool_var(f"assign_{staff_id}_{week_index}")
        for staff_id in group.eligibleStaffIds
        for week_index in range(len(group.weeks))
    }

    # Exactly teachersPerWeek staff per week.
    for week_index in range(len(group.weeks)):
        model.add(sum(assign[(staff_id, week_index)] for staff_id in group.eligibleStaffIds) == group.teachersPerWeek)

    # Soft gap-violation minimization — both within the term (pairs of
    # weeks closer than minWeeksBetweenRepeatDuty) and against each staff's
    # pre-term cooldown entry, if any.
    violations: list[Any] = []
    for staff_id in group.eligibleStaffIds:
        for i in range(len(group.weeks)):
            for j in range(i + 1, len(group.weeks)):
                if _week_gap(group.weeks[i], group.weeks[j]) >= group.minWeeksBetweenRepeatDuty:
                    continue
                violation = model.new_bool_var(f"violation_{staff_id}_{i}_{j}")
                model.add(assign[(staff_id, i)] + assign[(staff_id, j)] - 1 <= violation)
                violations.append(violation)

        recent = group.recentDutyByStaff.get(staff_id)
        if not recent:
            continue
        for week_index, week in enumerate(group.weeks):
            if _week_gap(week, recent) < group.minWeeksBetweenRepeatDuty:
                # Being assigned this week is itself the violation — no
                # separate indicator needed, the assign var already is one.
                violations.append(assign[(staff_id, week_index)])

    # Load-balancing objective (secondary): minimize the max total
    # duty-weeks any one staff member accumulates over the term — the
    # standard CP-SAT min-max idiom, same as invigilation.py's max_load.
    max_load = model.new_int_var(0, len(group.weeks), "max_load")
    for staff_id in group.eligibleStaffIds:
        model.add(sum(assign[(staff_id, week_index)] for week_index in range(len(group.weeks))) <= max_load)

    model.minimize(GAP_VIOLATION_WEIGHT * sum(violations) + BALANCE_WEIGHT * max_load)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = SOLVE_TIME_LIMIT_SECONDS
    status = solver.solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {
            "error": f"No feasible duty roster found for {group.classLevelCategoryGroup} (requestId={request_id})"
        }

    rows: list[dict[str, Any]] = []
    for (staff_id, week_index), var in assign.items():
        if solver.value(var):
            rows.append(
                {
                    "classLevelCategoryGroup": group.classLevelCategoryGroup,
                    "weekStartDate": group.weeks[week_index],
                    "staffId": staff_id,
                }
            )
    return rows


def solve_weekly_duty(request_id: str, callback_token: str, groups: list[WeeklyDutyGroupPayload]) -> dict[str, Any]:
    all_rows: list[dict[str, Any]] = []
    for group in groups:
        result = _solve_group(request_id, group)
        if isinstance(result, dict) and "error" in result:
            return {"callbackToken": callback_token, "error": result["error"]}
        all_rows.extend(result)

    return {"callbackToken": callback_token, "result": {"generatedRows": all_rows}}
