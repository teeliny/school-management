import { Controller, Get } from "@nestjs/common";
import type { HealthResponse } from "@school/types";

/**
 * Phase 0: no BullMQ queues exist yet, so there's nothing to report on beyond
 * "the process is up." Once docs/ARCHITECTURE.md §8's queues exist, this should
 * report queue connectivity too.
 */
@Controller("health")
export class HealthController {
  @Get()
  check(): HealthResponse {
    return { status: "ok", service: "worker" };
  }
}
