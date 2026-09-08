import { Logger, OnModuleInit } from "@nestjs/common";
import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job, Queue } from "bullmq";
import { QUEUE_NAMES } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";

// One repeatable job per month rather than a single comma-separated-month
// cron pattern — April and December's last day (30/31) differ from
// August's, and BullMQ's `pattern` is a plain five-field cron expression
// with a single day-of-month value, so the three can't be expressed in one
// entry. Each fires once, at 23:30 server time, on that month's last day.
const REPEATABLE_JOBS = [
  { jobId: "audit-log-retention-april", pattern: "30 23 30 4 *" },
  { jobId: "audit-log-retention-august", pattern: "30 23 31 8 *" },
  { jobId: "audit-log-retention-december", pattern: "30 23 31 12 *" },
];

/**
 * Runs at the end of every term (PRD's 3-term Nigerian calendar: roughly
 * Sept–Dec, Jan–Apr, May–Aug), keeping the AuditLog table down to the term
 * that's just ending plus everything after it, rather than letting years of
 * "who changed what" history accumulate indefinitely. Deliberately not a
 * full wipe — it anchors the cutoff to the actual configured Term.startDate
 * closest to now (not a hardcoded calendar date), so it stays correct even
 * if a school's term dates don't land exactly on month-end.
 */
@Processor(QUEUE_NAMES.AUDIT_LOG_RETENTION)
export class AuditLogRetentionProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(AuditLogRetentionProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.AUDIT_LOG_RETENTION) private readonly retentionQueue: Queue,
  ) {
    super();
  }

  // BullMQ dedupes a repeatable job by its (name, repeat pattern, jobId), so
  // re-adding these on every worker boot is idempotent, same precedent as
  // AssessmentSweepProcessor.onModuleInit / InvoiceOverdueSweepProcessor.onModuleInit.
  async onModuleInit() {
    for (const { jobId, pattern } of REPEATABLE_JOBS) {
      await this.retentionQueue.add("retain", {}, { repeat: { pattern }, jobId });
    }
  }

  async process(_job: Job): Promise<void> {
    const now = new Date();
    // The most recently-started Term as of now — at the moment this fires
    // (end of that term's own month), that's the term that's just ending,
    // not the one after it.
    const currentTerm = await this.prisma.term.findFirst({
      where: { startDate: { lte: now } },
      orderBy: { startDate: "desc" },
    });

    if (!currentTerm) {
      this.logger.log("Audit log retention: no Term configured yet, skipping");
      return;
    }

    const { count } = await this.prisma.auditLog.deleteMany({
      where: { createdAt: { lt: currentTerm.startDate } },
    });
    this.logger.log(
      `Audit log retention: deleted ${count} row(s) older than term "${currentTerm.name}" (${currentTerm.startDate.toISOString()})`,
    );
  }
}
