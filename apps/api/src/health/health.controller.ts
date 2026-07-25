import { Controller, Get } from "@nestjs/common";
import type { HealthResponse } from "@school/types";

/**
 * Phase 0: no dependency checks yet (DB/Redis/Resend/Monnify). Those are added
 * per docs/ARCHITECTURE.md §13 as each dependency actually comes online in later phases.
 */
@Controller("health")
export class HealthController {
  @Get()
  check(): HealthResponse {
    return { status: "ok", service: "api" };
  }
}
