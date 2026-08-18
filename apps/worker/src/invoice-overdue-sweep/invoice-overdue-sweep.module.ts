import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { QUEUE_NAMES } from "@school/types";
import { InvoiceOverdueSweepProcessor } from "./invoice-overdue-sweep.processor";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.INVOICE_OVERDUE_SWEEP }), NotificationsModule],
  providers: [InvoiceOverdueSweepProcessor],
})
export class InvoiceOverdueSweepModule {}
