import { Module } from "@nestjs/common";
import { StaffAssignmentController, StaffAssignmentService } from "./staff-assignment";

// Maps to ARCHITECTURE.md §5's StaffModule — depends on IdentityModule
// (StaffProfile) and AcademicStructureModule (ClassArm/AcademicSession),
// both satisfied via PrismaService directly (no cross-module service calls
// needed yet).
@Module({
  controllers: [StaffAssignmentController],
  providers: [StaffAssignmentService],
  exports: [StaffAssignmentService],
})
export class StaffAssignmentsModule {}
