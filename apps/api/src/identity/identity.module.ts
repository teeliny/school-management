import { Module } from "@nestjs/common";
import { UserService } from "./users/user.service";
import { InvitationService } from "./invitations/invitation.service";
import { InvitationsController } from "./invitations/invitations.controller";

@Module({
  controllers: [InvitationsController],
  providers: [UserService, InvitationService],
  exports: [UserService, InvitationService],
})
export class IdentityModule {}
