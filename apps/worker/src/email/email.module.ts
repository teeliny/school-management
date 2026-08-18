import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { QUEUE_NAMES } from "@school/types";
import { EmailProcessor } from "./email.processor";

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.EMAIL_DISPATCH })],
  providers: [EmailProcessor],
})
export class EmailModule {}
