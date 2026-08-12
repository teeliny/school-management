import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { ScheduleGenerationStatus } from "@prisma/client";
import { QUEUE_NAMES, type SchedulingSolveDispatchJob } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";

/**
 * ARCHITECTURE.md §9: hands a solve request to the scheduling-engine and
 * flips the tracking row to SOLVING. Per-scope domain-data resolution
 * (subjects, staff, existing slots) is not built yet — this Step 1 slice
 * only forwards the resolved SchedulingConstraint rows and the request's own
 * `parameters`; BUILD_PLAN.md §9 Steps 2–5 extend the payload per scope. If
 * this POST itself fails (scheduling-engine unreachable), the error
 * propagates and the ScheduleGenerationRequest is left QUEUED — the timeout
 * sweep (SchedulingTimeoutSweepProcessor) catches it rather than this job
 * retrying indefinitely, same "let the sweep catch stragglers" shape as
 * payment-reconciliation.
 */
@Processor(QUEUE_NAMES.SCHEDULING_SOLVE_DISPATCH)
export class SchedulingSolveDispatchProcessor extends WorkerHost {
  private readonly logger = new Logger(SchedulingSolveDispatchProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    super();
  }

  async process(job: Job<SchedulingSolveDispatchJob>): Promise<void> {
    const { requestId } = job.data;
    const request = await this.prisma.scheduleGenerationRequest.findUniqueOrThrow({ where: { id: requestId } });

    const constraints = await this.prisma.schedulingConstraint.findMany({
      where: { scope: request.scope, isActive: true },
    });

    const engineUrl = this.config.getOrThrow<string>("SCHEDULING_ENGINE_URL");
    const callbackBaseUrl = this.config.getOrThrow<string>("SCHEDULING_CALLBACK_BASE_URL");

    const response = await fetch(`${engineUrl}/solve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: request.id,
        constraints: constraints.map((c) => ({ key: c.key, value: c.value })),
        parameters: request.parameters ?? {},
        // apps/api's global prefix is "api/v1" (main.ts's setGlobalPrefix),
        // excluded only for /health — every other route, including this
        // callback, needs it. SCHEDULING_CALLBACK_BASE_URL is a bare host,
        // same convention as apps/web's proxy route appending it itself.
        callbackUrl: `${callbackBaseUrl}/api/v1/internal/scheduling-callback/${request.id}`,
        callbackToken: request.callbackToken,
      }),
    });

    if (!response.ok) {
      throw new Error(`scheduling-engine /solve returned ${response.status}`);
    }

    await this.prisma.scheduleGenerationRequest.update({
      where: { id: requestId },
      data: { status: ScheduleGenerationStatus.SOLVING },
    });
    this.logger.log(`Dispatched ${request.scope} solve for request ${requestId}`);
  }
}
