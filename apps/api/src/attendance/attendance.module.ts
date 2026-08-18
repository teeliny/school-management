import { Module } from "@nestjs/common";
import { SchoolHolidayController, SchoolHolidayService } from "./school-holiday";
import { AttendanceSessionController, AttendanceSessionService } from "./attendance-session";
import { AttendanceRecordController, AttendanceRecordService } from "./attendance-record";
import { AttendanceAnalyticsController, AttendanceAnalyticsService } from "./attendance-analytics";
import { StaffAssignmentsModule } from "../staff-assignments/staff-assignments.module";
import { AcademicStructureModule } from "../academic-structure/academic-structure.module";

// Maps to ARCHITECTURE.md §5's AttendanceModule — depends on
// StaffAssignmentsModule for the "is this the assigned class/subject
// teacher" checks (same pattern as AssessmentModule) and
// AcademicStructureModule for SchoolProfileService (back-date window +
// granularity settings).
@Module({
  imports: [StaffAssignmentsModule, AcademicStructureModule],
  controllers: [SchoolHolidayController, AttendanceSessionController, AttendanceRecordController, AttendanceAnalyticsController],
  providers: [SchoolHolidayService, AttendanceSessionService, AttendanceRecordService, AttendanceAnalyticsService],
})
export class AttendanceModule {}
