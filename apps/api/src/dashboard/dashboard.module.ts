import { Module } from "@nestjs/common";
import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";
import { StaffAssignmentsModule } from "../staff-assignments/staff-assignments.module";
import { AssessmentsModule } from "../assessments/assessments.module";
import { AcademicStructureModule } from "../academic-structure/academic-structure.module";

// BUILD_PLAN.md §10 (Phase 8 — Dashboards): presentation over data every
// prior phase already produces, so this module has no providers of its own
// beyond DashboardService — it reads via PrismaService (global) plus
// StaffAssignmentService for the Bursar/CLASS_TEACHER/etc. ownership checks
// CASL can't express cleanly for a subject-spanning endpoint like this one
// (see DashboardService's own comment on skipping CASL entirely),
// AssessmentsModule (for its exported BroadsheetService) for the Principal/
// Headteacher broadsheet-snapshot widget, and AcademicStructureModule (for
// its exported SchoolProfileService) for the Parent/Student attendance
// summary's school-days-opened calculation.
@Module({
  imports: [StaffAssignmentsModule, AssessmentsModule, AcademicStructureModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
