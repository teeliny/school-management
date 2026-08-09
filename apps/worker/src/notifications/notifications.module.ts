import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { QUEUE_NAMES } from "@school/types";
import { WorkerNotificationService } from "./worker-notification.service";

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.EMAIL_DISPATCH })],
  providers: [WorkerNotificationService],
  exports: [WorkerNotificationService],
})
export class NotificationsModule {}
