import { Module } from "@nestjs/common";
import { SubjectModule } from "../subjects/subject.module";
import { UserService } from "./users/user.service";
import { InvitationService } from "./invitations/invitation.service";
import { InvitationsController } from "./invitations/invitations.controller";
import { AdminProfileController, AdminProfileService } from "./profiles/admin-profile";
import { StaffProfileController, StaffProfileService } from "./profiles/staff-profile";
import { ParentProfileController, ParentProfileService } from "./profiles/parent-profile";
import { StudentController, StudentService } from "./students/student";
import { OwnershipTransferController, OwnershipTransferService } from "./ownership-transfer";
import { SetupController, SetupService } from "./setup/setup";

@Module({
  imports: [SubjectModule],
  controllers: [
    InvitationsController,
    AdminProfileController,
    StaffProfileController,
    ParentProfileController,
    StudentController,
    OwnershipTransferController,
    SetupController,
  ],
  providers: [
    UserService,
    InvitationService,
    AdminProfileService,
    StaffProfileService,
    ParentProfileService,
    StudentService,
    OwnershipTransferService,
    SetupService,
  ],
  exports: [UserService, InvitationService, StaffProfileService, ParentProfileService, StudentService],
})
export class IdentityModule {}
