import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str = "ok"
    service: str = "scheduling-engine"


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


# Phase 0: just a health check. The real /solve endpoint (docs/ARCHITECTURE.md §9)
# — stateless, receives constraints + a callback URL/token, calls back to the
# NestJS API when the CP-SAT solve is done — arrives in Phase 7.
@app.get("/health")
def health() -> HealthResponse:
    return HealthResponse()
