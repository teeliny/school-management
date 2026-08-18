import { Injectable } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { Gauge, Registry, collectDefaultMetrics } from "prom-client";
import { QUEUE_NAMES } from "@school/types";

const QUEUE_STATES = ["waiting", "active", "delayed", "failed"] as const;

/**
 * ARCHITECTURE.md §13: "BullMQ queue depth/age per queue" — every queue
 * this worker owns (ARCHITECTURE §8's full list), gauges computed live at
 * scrape time rather than pushed on an interval. Registering the same
 * queue name a second time in a different module (here, purely to read
 * counts) is already an established safe pattern in this codebase — e.g.
 * EMAIL_DISPATCH is registered in both email.module.ts and
 * notifications.module.ts today.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  private readonly queues: [string, Queue][];

  constructor(
    @InjectQueue(QUEUE_NAMES.ASSESSMENT_SCHEDULE_SWEEP) assessmentScheduleSweep: Queue,
    @InjectQueue(QUEUE_NAMES.REPORT_CARD_GENERATION) reportCardGeneration: Queue,
    @InjectQueue(QUEUE_NAMES.RECEIPT_GENERATION) receiptGeneration: Queue,
    @InjectQueue(QUEUE_NAMES.PAYMENT_RECONCILIATION) paymentReconciliation: Queue,
    @InjectQueue(QUEUE_NAMES.EMAIL_DISPATCH) emailDispatch: Queue,
    @InjectQueue(QUEUE_NAMES.INVOICE_OVERDUE_SWEEP) invoiceOverdueSweep: Queue,
    @InjectQueue(QUEUE_NAMES.SUBJECT_TERM_RESULT_RECOMPUTE) subjectTermResultRecompute: Queue,
    @InjectQueue(QUEUE_NAMES.SCHEDULING_SOLVE_DISPATCH) schedulingSolveDispatch: Queue,
    @InjectQueue(QUEUE_NAMES.SCHEDULING_TIMEOUT_SWEEP) schedulingTimeoutSweep: Queue,
  ) {
    this.queues = [
      [QUEUE_NAMES.ASSESSMENT_SCHEDULE_SWEEP, assessmentScheduleSweep],
      [QUEUE_NAMES.REPORT_CARD_GENERATION, reportCardGeneration],
      [QUEUE_NAMES.RECEIPT_GENERATION, receiptGeneration],
      [QUEUE_NAMES.PAYMENT_RECONCILIATION, paymentReconciliation],
      [QUEUE_NAMES.EMAIL_DISPATCH, emailDispatch],
      [QUEUE_NAMES.INVOICE_OVERDUE_SWEEP, invoiceOverdueSweep],
      [QUEUE_NAMES.SUBJECT_TERM_RESULT_RECOMPUTE, subjectTermResultRecompute],
      [QUEUE_NAMES.SCHEDULING_SOLVE_DISPATCH, schedulingSolveDispatch],
      [QUEUE_NAMES.SCHEDULING_TIMEOUT_SWEEP, schedulingTimeoutSweep],
    ];

    collectDefaultMetrics({ register: this.registry });

    const queues = this.queues;

    new Gauge({
      name: "bullmq_queue_depth",
      help: "Job count per BullMQ queue and state",
      labelNames: ["queue", "state"],
      registers: [this.registry],
      async collect(this: Gauge<"queue" | "state">) {
        for (const [name, queue] of queues) {
          const counts = await queue.getJobCounts(...QUEUE_STATES);
          for (const state of QUEUE_STATES) {
            this.set({ queue: name, state }, counts[state] ?? 0);
          }
        }
      },
    });

    new Gauge({
      name: "bullmq_queue_oldest_waiting_job_age_seconds",
      help: "Age in seconds of the oldest waiting job per BullMQ queue",
      labelNames: ["queue"],
      registers: [this.registry],
      async collect(this: Gauge<"queue">) {
        for (const [name, queue] of queues) {
          const [oldest] = await queue.getWaiting(0, 0);
          this.set({ queue: name }, oldest ? (Date.now() - oldest.timestamp) / 1000 : 0);
        }
      },
    });
  }

  metrics(): Promise<string> {
    return this.registry.metrics();
  }
}
