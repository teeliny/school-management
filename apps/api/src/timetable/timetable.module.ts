import { Module } from "@nestjs/common";
import { TimetableSlotController, TimetableSlotService } from "./timetable-slot";

// Maps to ARCHITECTURE.md §5's TimetableModule — depends on SubjectModule
// (Subject) and StaffModule (StaffProfile), satisfied via PrismaService
// directly (no cross-module service calls needed here), same precedent as
// StaffAssignmentsModule.
@Module({
  controllers: [TimetableSlotController],
  providers: [TimetableSlotService],
  // BUILD_PLAN.md §9 Step 2: ExamSchedulingModule reuses assertNoConflicts
  // as a final safety net before persisting AI-generated TimetableSlot rows.
  exports: [TimetableSlotService],
})
export class TimetableModule {}
