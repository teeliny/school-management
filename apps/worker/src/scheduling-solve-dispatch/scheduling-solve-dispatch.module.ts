import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { QUEUE_NAMES } from "@school/types";
import { SchedulingSolveDispatchProcessor } from "./scheduling-solve-dispatch.processor";

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.SCHEDULING_SOLVE_DISPATCH })],
  providers: [SchedulingSolveDispatchProcessor],
})
export class SchedulingSolveDispatchModule {}
