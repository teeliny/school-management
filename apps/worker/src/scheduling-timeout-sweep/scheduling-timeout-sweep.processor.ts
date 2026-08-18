import { Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job, Queue } from "bullmq";
import { ScheduleGenerationStatus } from "@prisma/client";
import { QUEUE_NAMES } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";
import { WorkerNotificationService } from "../notifications/worker-notification.service";

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const REPEATABLE_JOB_ID = "scheduling-timeout-sweep-repeatable";
const DEFAULT_TIMEOUT_MINUTES = 10;

/**
 * PRD FR6.9/ARCHITECTURE.md §9: mirrors the payment-reconciliation pattern —
 * a ScheduleGenerationRequest stuck QUEUED/SOLVING past the configurable
 * threshold (env SCHEDULING_TIMEOUT_MINUTES, default 10) never got a
 * callback from the scheduling-engine (dispatch failure, a crashed solve, a
 * lost response) and is marked TIMED_OUT rather than left silently stuck.
 */
@Processor(QUEUE_NAMES.SCHEDULING_TIMEOUT_SWEEP)
export class SchedulingTimeoutSweepProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(SchedulingTimeoutSweepProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: WorkerNotificationService,
    @InjectQueue(QUEUE_NAMES.SCHEDULING_TIMEOUT_SWEEP) private readonly sweepQueue: Queue,
  ) {
    super();
  }

  async onModuleInit() {
    await this.sweepQueue.add("sweep", {}, { repeat: { every: SWEEP_INTERVAL_MS }, jobId: REPEATABLE_JOB_ID });
  }

  async process(_job: Job): Promise<void> {
    const timeoutMinutes = Number(this.config.get<string>("SCHEDULING_TIMEOUT_MINUTES")) || DEFAULT_TIMEOUT_MINUTES;
    const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000);

    const stuckRequests = await this.prisma.scheduleGenerationRequest.findMany({
      where: {
        status: { in: [ScheduleGenerationStatus.QUEUED, ScheduleGenerationStatus.SOLVING] },
        requestedAt: { lt: cutoff },
      },
    });

    for (const request of stuckRequests) {
      await this.prisma.scheduleGenerationRequest.update({
        where: { id: request.id },
        data: { status: ScheduleGenerationStatus.TIMED_OUT, completedAt: new Date() },
      });
      try {
        await this.notifications.notify(request.requestedByUserId, "SCHEDULE_GENERATION_TIMED_OUT", {
          scope: request.scope,
        });
      } catch (error) {
        this.logger.warn(`Failed to notify ${request.requestedByUserId} of SCHEDULE_GENERATION_TIMED_OUT: ${String(error)}`);
      }
    }

    if (stuckRequests.length > 0) {
      this.logger.log(`Timeout sweep marked ${stuckRequests.length} schedule generation request(s) TIMED_OUT`);
    }
  }
}
