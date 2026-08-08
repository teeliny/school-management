import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { QUEUE_NAMES } from "@school/types";
import { FeeStructureController, FeeStructureService } from "./fee-structure";
import { InvoiceController, InvoiceService } from "./invoice";
import { PaymentController, PaymentService } from "./payment";
import { AcademicStructureModule } from "../academic-structure/academic-structure.module";

// Maps to ARCHITECTURE.md §5's FeesModule — depends on AcademicStructureModule
// (Term/ClassLevel/AcademicSession) and dispatches to apps/worker's new
// ReceiptModule via the receipt-generation queue, same producer/consumer
// split as AssessmentsModule's report-card-generation queue.
@Module({
  imports: [AcademicStructureModule, BullModule.registerQueue({ name: QUEUE_NAMES.RECEIPT_GENERATION })],
  controllers: [FeeStructureController, InvoiceController, PaymentController],
  providers: [FeeStructureService, InvoiceService, PaymentService],
})
export class FeesModule {}
