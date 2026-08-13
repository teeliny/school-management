import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { QUEUE_NAMES } from "@school/types";
import { SchedulingConstraintController, SchedulingConstraintService } from "./scheduling-constraint";
import { ScheduleGenerationRequestController, ScheduleGenerationRequestService } from "./schedule-generation-request";
import { SchedulingCallbackController } from "./scheduling-callback.controller";
import { ExamScheduleController, ExamScheduleService } from "./exam-schedule";
import { InvigilationAssignmentController, InvigilationAssignmentService } from "./invigilation-assignment";
import { DutyAssignmentController, DutyAssignmentService } from "./duty-assignment";
import { NotificationsModule } from "../notifications/notifications.module";
import { TimetableModule } from "../timetable/timetable.module";

// ARCHITECTURE.md §9's ExamSchedulingModule — named for the whole AI
// scheduling domain; BUILD_PLAN.md §9 Step 1 built the async dispatch/
// callback/timeout-sweep plumbing, Step 2 added real CLASS_TIMETABLE
// persistence (reusing TimetableModule's assertNoConflicts), Step 3 added
// real EXAM_TIMETABLE persistence, Step 4 added real INVIGILATION
// persistence, Step 5 added DutyAssignment persistence. Step 6 adds the
// read/approve/reject controllers for all three (TimetableSlot's own
// approve/reject lives on TimetableSlotController instead, in
// TimetableModule).
@Module({
  imports: [
    NotificationsModule,
    TimetableModule,
    // Producer side only — apps/api enqueues, apps/worker consumes, same
    // split as every other queue in this codebase.
    BullModule.registerQueue({ name: QUEUE_NAMES.SCHEDULING_SOLVE_DISPATCH }),
  ],
  controllers: [
    SchedulingConstraintController,
    ScheduleGenerationRequestController,
    SchedulingCallbackController,
    ExamScheduleController,
    InvigilationAssignmentController,
    DutyAssignmentController,
  ],
  providers: [
    SchedulingConstraintService,
    ScheduleGenerationRequestService,
    ExamScheduleService,
    InvigilationAssignmentService,
    DutyAssignmentService,
  ],
})
export class ExamSchedulingModule {}
