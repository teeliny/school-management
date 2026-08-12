import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { QUEUE_NAMES } from "@school/types";
import { SchedulingTimeoutSweepProcessor } from "./scheduling-timeout-sweep.processor";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.SCHEDULING_TIMEOUT_SWEEP }), NotificationsModule],
  providers: [SchedulingTimeoutSweepProcessor],
})
export class SchedulingTimeoutSweepModule {}
