from fastapi import FastAPI
from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str = "ok"
    service: str = "scheduling-engine"


app = FastAPI(title="scheduling-engine")


# Phase 0: just a health check. The real /solve endpoint (docs/ARCHITECTURE.md §9)
# — stateless, receives constraints + a callback URL/token, calls back to the
# NestJS API when the CP-SAT solve is done — arrives in Phase 7.
@app.get("/health")
def health() -> HealthResponse:
    return HealthResponse()
