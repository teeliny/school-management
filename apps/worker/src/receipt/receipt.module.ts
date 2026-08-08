import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { QUEUE_NAMES } from "@school/types";
import { ReceiptProcessor } from "./receipt.processor";

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.RECEIPT_GENERATION })],
  providers: [ReceiptProcessor],
})
export class ReceiptModule {}
