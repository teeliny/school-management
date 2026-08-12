import os
from typing import Any

import httpx
from fastapi import BackgroundTasks, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.class_timetable import GroupPayload, solve_class_timetable
from app.exam_timetable import ExamClassArmPayload, solve_exam_timetable


class HealthResponse(BaseModel):
    status: str = "ok"
    service: str = "scheduling-engine"


class SolveRequest(BaseModel):
    requestId: str
    callbackUrl: str
    callbackToken: str
    scope: str | None = None

    # Generic shape (BUILD_PLAN.md §9 Step 1) — used by every scope that
    # doesn't yet have real solver logic (INVIGILATION/WEEKLY_DUTY, Steps 4-5).
    constraints: list[dict[str, Any]] = []
    parameters: dict[str, Any] = {}

    # CLASS_TIMETABLE-specific shape (BUILD_PLAN.md §9 Step 2).
    calculationSubjectsMorning: bool = True
    spreadCalculationSubjects: bool = True
    groups: list[GroupPayload] = []

    # EXAM_TIMETABLE-specific shape (BUILD_PLAN.md §9 Step 3).
    days: list[str] = []
    examDayStartTime: str = "09:00"
    maxSubjectsPerDay: int = 2
    calculationSubjectDurationMinutes: int = 90
    nonCalculationSubjectDurationMinutes: int = 60
    minGapBetweenCalculationExamsDays: int = 1
    classArms: list[ExamClassArmPayload] = []


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
    CLASS_TIMETABLE (BUILD_PLAN.md §9 Step 2) and EXAM_TIMETABLE (Step 3)
    run real CP-SAT models. Every other scope still gets Step 1's stub
    behavior — an immediate empty-result callback — until its own step
    lands (Steps 4-5).
    """
    if payload.scope == "CLASS_TIMETABLE":
        body: dict[str, Any] = solve_class_timetable(
            request_id=payload.requestId,
            callback_token=payload.callbackToken,
            calculation_subjects_morning=payload.calculationSubjectsMorning,
            spread_calculation_subjects=payload.spreadCalculationSubjects,
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
    else:
        body = {
            "callbackToken": payload.callbackToken,
            "result": {"generatedRows": []},
        }

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            await client.post(payload.callbackUrl, json=body)
        except httpx.HTTPError as exc:
            # The dispatching side's timeout sweep (ARCHITECTURE.md §9)
            # catches a request that never got a callback — nothing to
            # retry here, this service is stateless and holds no queue of
            # its own to redeliver from.
            print(f"Callback POST to {payload.callbackUrl} failed: {exc}")


# ARCHITECTURE.md §9: fire-and-forget — returns 202 immediately, solves (or,
# for now, stub-completes) in the background, then calls back to NestJS.
@app.post("/solve", status_code=202)
def solve(payload: SolveRequest, background_tasks: BackgroundTasks) -> SolveAccepted:
    background_tasks.add_task(_solve_and_callback, payload)
    return SolveAccepted()
