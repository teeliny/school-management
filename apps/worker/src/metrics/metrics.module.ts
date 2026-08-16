import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { QUEUE_NAMES } from "@school/types";
import { MetricsController } from "./metrics.controller";
import { MetricsService } from "./metrics.service";

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_NAMES.ASSESSMENT_SCHEDULE_SWEEP },
      { name: QUEUE_NAMES.REPORT_CARD_GENERATION },
      { name: QUEUE_NAMES.RECEIPT_GENERATION },
      { name: QUEUE_NAMES.PAYMENT_RECONCILIATION },
      { name: QUEUE_NAMES.EMAIL_DISPATCH },
      { name: QUEUE_NAMES.INVOICE_OVERDUE_SWEEP },
      { name: QUEUE_NAMES.SUBJECT_TERM_RESULT_RECOMPUTE },
      { name: QUEUE_NAMES.SCHEDULING_SOLVE_DISPATCH },
      { name: QUEUE_NAMES.SCHEDULING_TIMEOUT_SWEEP },
    ),
  ],
  controllers: [MetricsController],
  providers: [MetricsService],
})
export class MetricsModule {}
