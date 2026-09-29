import { Module } from "@nestjs/common";
import { HomeworkController, HomeworkService } from "./homework";
import { StaffAssignmentsModule } from "../staff-assignments/staff-assignments.module";
import { SubjectModule } from "../subjects/subject.module";
import { AssessmentsModule } from "../assessments/assessments.module";
import { NotificationsModule } from "../notifications/notifications.module";

// PRD §3.6a. Depends on AssessmentsModule only for ScoreEntryService — the
// opt-in "transfer to gradebook" path for a CA-linked homework — and never
// the other way round: nothing in AssessmentsModule reads homework.
@Module({
  imports: [StaffAssignmentsModule, SubjectModule, AssessmentsModule, NotificationsModule],
  controllers: [HomeworkController],
  providers: [HomeworkService],
})
export class HomeworkModule {}
