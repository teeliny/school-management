import { Logger, OnModuleInit } from "@nestjs/common";
import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job, Queue } from "bullmq";
import { InvoiceStatus } from "@prisma/client";
import { computeInvoiceStatus, computeOutstandingBalance, QUEUE_NAMES } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";
import { WorkerNotificationService } from "../notifications/worker-notification.service";

// Overdue detection is date-granularity, not minute-granularity, so this
// doesn't need the 5-minute cadence assessment-schedule-sweep/payment-
// reconciliation use for genuinely time-sensitive transitions.
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const REPEATABLE_JOB_ID = "invoice-overdue-sweep-repeatable";

@Processor(QUEUE_NAMES.INVOICE_OVERDUE_SWEEP)
export class InvoiceOverdueSweepProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(InvoiceOverdueSweepProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: WorkerNotificationService,
    @InjectQueue(QUEUE_NAMES.INVOICE_OVERDUE_SWEEP) private readonly sweepQueue: Queue,
  ) {
    super();
  }

  // BullMQ dedupes a repeatable job by its (name, repeat pattern, jobId), so
  // re-adding this on every worker boot is idempotent, same precedent as
  // AssessmentSweepProcessor.onModuleInit.
  async onModuleInit() {
    await this.sweepQueue.add("sweep", {}, { repeat: { every: SWEEP_INTERVAL_MS }, jobId: REPEATABLE_JOB_ID });
  }

  async process(_job: Job): Promise<void> {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        status: { in: [InvoiceStatus.UNPAID, InvoiceStatus.PARTIAL] },
        dueDate: { lt: new Date() },
      },
      include: {
        lineItems: true,
        payments: true,
        student: { include: { user: true, guardians: { include: { parent: true } } } },
      },
    });

    let flipped = 0;
    const now = new Date();

    for (const invoice of invoices) {
      const discountAmounts = invoice.lineItems.filter((li) => li.type === "DISCOUNT").map((li) => Number(li.amount));
      const successfulPaymentAmounts = invoice.payments
        .filter((p) => p.status === "SUCCESSFUL")
        .map((p) => Number(p.amount));
      const outstandingBalance = computeOutstandingBalance(Number(invoice.totalAmount), discountAmounts, successfulPaymentAmounts);
      const paidTotal = successfulPaymentAmounts.reduce((sum, amount) => sum + amount, 0);
      const status = computeInvoiceStatus(outstandingBalance, paidTotal, invoice.dueDate, now);

      // The where-clause already guarantees this, but never trust a stored
      // status blindly — same backstop shape as ScoreEntry's group-subject
      // check.
      if (status !== "OVERDUE") continue;

      await this.prisma.invoice.update({ where: { id: invoice.id }, data: { status: InvoiceStatus.OVERDUE } });
      flipped++;

      const studentName = `${invoice.student.user.firstName} ${invoice.student.user.lastName}`;
      for (const guardian of invoice.student.guardians) {
        try {
          await this.notifications.notify(guardian.parent.userId, "INVOICE_OVERDUE", {
            studentName,
            outstandingAmount: outstandingBalance,
          });
        } catch (error) {
          this.logger.warn(`Failed to notify ${guardian.parent.userId} of INVOICE_OVERDUE: ${String(error)}`);
        }
      }
    }

    this.logger.log(`Overdue sweep flipped ${flipped} invoice(s) to OVERDUE`);
  }
}
