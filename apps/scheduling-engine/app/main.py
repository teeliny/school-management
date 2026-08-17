import os
from typing import Any

import httpx
from fastapi import BackgroundTasks, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.class_timetable import GroupPayload, solve_class_timetable
from app.exam_timetable import ExamClassArmPayload, solve_exam_timetable
from app.invigilation import InvigilationExamPayload, StaffExistingLoadPayload, solve_invigilation
from app.weekly_duty import WeeklyDutyGroupPayload, solve_weekly_duty


class HealthResponse(BaseModel):
    status: str = "ok"
    service: str = "scheduling-engine"


class SolveRequest(BaseModel):
    requestId: str
    callbackUrl: str
    callbackToken: str
    scope: str | None = None

    # Generic shape (BUILD_PLAN.md §9 Step 1) — used by every scope that
    # doesn't yet have real solver logic.
    constraints: list[dict[str, Any]] = []
    parameters: dict[str, Any] = {}

    # CLASS_TIMETABLE-specific shape (BUILD_PLAN.md §9 Step 2).
    calculationSubjectsMorning: bool = True
    groups: list[GroupPayload] = []

    # EXAM_TIMETABLE-specific shape (BUILD_PLAN.md §9 Step 3).
    days: list[str] = []
    examDayStartTime: str = "09:00"
    maxSubjectsPerDay: int = 2
    calculationSubjectDurationMinutes: int = 90
    nonCalculationSubjectDurationMinutes: int = 60
    spreadCalculationSubjects: bool = True
    minGapBetweenCalculationExamsDays: int = 1
    classArms: list[ExamClassArmPayload] = []

    # INVIGILATION-specific shape (BUILD_PLAN.md §9 Step 4).
    maxInvigilationsPerStaffPerDay: int = 2
    hardExcludeOwnSubjectTeacher: bool = True
    exams: list[InvigilationExamPayload] = []
    eligibleStaffIds: list[str] = []
    existingLoad: dict[str, StaffExistingLoadPayload] = {}

    # WEEKLY_DUTY-specific shape (BUILD_PLAN.md §9 Step 5). Named
    # "dutyGroups", not "groups" — CLASS_TIMETABLE's "groups" field above
    # already has a different element shape (GroupPayload).
    dutyGroups: list[WeeklyDutyGroupPayload] = []


class SolveAccepted(BaseModel):
    accepted: bool = True


app = FastAPI(title="scheduling-engine")

# In practice this service is only ever called server-to-server (NestJS ->
# /solve, this service -> NestJS's callback, ARCHITECTURE.md §9), so CORS
# wouldn't normally apply — no browser calls it directly. Configured anyway,
# the same way as api/worker, so there's no silent gap if that ever changes.
_cors_origins = [
    origin.strip()
    for origin in os.environ.get(
        "CORS_ORIGIN", os.environ.get("WEB_BASE_URL", "http://localhost:3000")
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> HealthResponse:
    return HealthResponse()


async def _solve_and_callback(payload: SolveRequest) -> None:
    """
    CLASS_TIMETABLE (BUILD_PLAN.md §9 Step 2), EXAM_TIMETABLE (Step 3),
    INVIGILATION (Step 4), and WEEKLY_DUTY (Step 5) all run real CP-SAT
    models. Any future scope still gets Step 1's stub behavior — an
    immediate empty-result callback — until its own step lands.
    """
    if payload.scope == "CLASS_TIMETABLE":
        body: dict[str, Any] = solve_class_timetable(
            request_id=payload.requestId,
            callback_token=payload.callbackToken,
            calculation_subjects_morning=payload.calculationSubjectsMorning,
            groups=payload.groups,
        )
    elif payload.scope == "EXAM_TIMETABLE":
        body = solve_exam_timetable(
            request_id=payload.requestId,
            callback_token=payload.callbackToken,
            days=payload.days,
            exam_day_start_time=payload.examDayStartTime,
            max_subjects_per_day=payload.maxSubjectsPerDay,
            calculation_subject_duration_minutes=payload.calculationSubjectDurationMinutes,
            non_calculation_subject_duration_minutes=payload.nonCalculationSubjectDurationMinutes,
            spread_calculation_subjects=payload.spreadCalculationSubjects,
            min_gap_between_calculation_exams_days=payload.minGapBetweenCalculationExamsDays,
            class_arms=payload.classArms,
        )
    elif payload.scope == "INVIGILATION":
        body = solve_invigilation(
            request_id=payload.requestId,
            callback_token=payload.callbackToken,
            max_invigilations_per_staff_per_day=payload.maxInvigilationsPerStaffPerDay,
            hard_exclude_own_subject_teacher=payload.hardExcludeOwnSubjectTeacher,
            exams=payload.exams,
            eligible_staff_ids=payload.eligibleStaffIds,
            existing_load=payload.existingLoad,
        )
    elif payload.scope == "WEEKLY_DUTY":
        body = solve_weekly_duty(
            request_id=payload.requestId,
            callback_token=payload.callbackToken,
            groups=payload.dutyGroups,
        )
    else:
        body = {
            "callbackToken": payload.callbackToken,
            "result": {"generatedRows": []},
        }

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            response = await client.post(payload.callbackUrl, json=body)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            # A non-2xx response (e.g. the callback handler threw while
            # persisting) was previously swallowed silently here — nothing
            # called raise_for_status(), so the request just sat at SOLVING
            # until the timeout sweep (ARCHITECTURE.md §9) flagged it with no
            # errorMessage. Logging the body at least surfaces why.
            print(f"Callback POST to {payload.callbackUrl} returned {exc.response.status_code}: {exc.response.text}")
        except httpx.HTTPError as exc:
            # Connection-level failure (unreachable, timeout, etc). Same
            # "let the timeout sweep catch it" reasoning — this service is
            # stateless and holds no queue of its own to redeliver from.
            print(f"Callback POST to {payload.callbackUrl} failed: {exc}")


# ARCHITECTURE.md §9: fire-and-forget — returns 202 immediately, solves (or,
# for now, stub-completes) in the background, then calls back to NestJS.
@app.post("/solve", status_code=202)
def solve(payload: SolveRequest, background_tasks: BackgroundTasks) -> SolveAccepted:
    background_tasks.add_task(_solve_and_callback, payload)
    return SolveAccepted()
