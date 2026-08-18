import { Controller, Get, HttpException, HttpStatus } from "@nestjs/common";
import type { HealthResponse } from "@school/types";
import { HealthService } from "./health.service";

@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  async check(): Promise<HealthResponse> {
    const result = await this.health.check();
    // A degraded body is still useful to a caller, so it's the full
    // HealthResponse as the exception's response object (Nest serializes it
    // as-is, not wrapped in {statusCode, message}) rather than a bare 503.
    if (result.status !== "ok") throw new HttpException(result, HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}
