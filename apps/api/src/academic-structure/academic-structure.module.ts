import { Module } from "@nestjs/common";
import { SchoolProfileController, SchoolProfileService } from "./school-profile";
import { AcademicSessionController, AcademicSessionService } from "./academic-session";
import { TermController, TermService } from "./term";
import { ClassLevelController, ClassLevelService } from "./class-level";
import { ClassArmController, ClassArmService } from "./class-arm";
import { DepartmentController, DepartmentService } from "./department";
import { StudentDepartmentController, StudentDepartmentService } from "./student-department";

@Module({
  controllers: [
    SchoolProfileController,
    AcademicSessionController,
    TermController,
    ClassLevelController,
    ClassArmController,
    DepartmentController,
    StudentDepartmentController,
  ],
  providers: [
    SchoolProfileService,
    AcademicSessionService,
    TermService,
    ClassLevelService,
    ClassArmService,
    DepartmentService,
    StudentDepartmentService,
  ],
  exports: [SchoolProfileService, AcademicSessionService],
})
export class AcademicStructureModule {}
