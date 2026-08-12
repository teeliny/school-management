import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { QUEUE_NAMES } from "@school/types";
import { SchedulingConstraintController, SchedulingConstraintService } from "./scheduling-constraint";
import { ScheduleGenerationRequestController, ScheduleGenerationRequestService } from "./schedule-generation-request";
import { SchedulingCallbackController } from "./scheduling-callback.controller";
import { NotificationsModule } from "../notifications/notifications.module";
import { TimetableModule } from "../timetable/timetable.module";

// ARCHITECTURE.md §9's ExamSchedulingModule — named for the whole AI
// scheduling domain; BUILD_PLAN.md §9 Step 1 built the async dispatch/
// callback/timeout-sweep plumbing, Step 2 adds real CLASS_TIMETABLE
// persistence (reusing TimetableModule's assertNoConflicts). Its own models
// (ExamSchedule, InvigilationAssignment, DutyAssignment) arrive in later
// steps.
@Module({
  imports: [
    NotificationsModule,
    TimetableModule,
    // Producer side only — apps/api enqueues, apps/worker consumes, same
    // split as every other queue in this codebase.
    BullModule.registerQueue({ name: QUEUE_NAMES.SCHEDULING_SOLVE_DISPATCH }),
  ],
  controllers: [SchedulingConstraintController, ScheduleGenerationRequestController, SchedulingCallbackController],
  providers: [SchedulingConstraintService, ScheduleGenerationRequestService],
})
export class ExamSchedulingModule {}
