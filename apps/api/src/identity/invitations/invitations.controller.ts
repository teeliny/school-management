import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { subject } from "@casl/ability";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { CurrentUser } from "../../auth/current-user.decorator";
import type { RequestUser } from "../../auth/jwt.strategy";
import { AbilityFactory } from "../../casl/ability.factory";
import { InvitationService } from "./invitation.service";
import { Audited } from "../../audit/audited.decorator";
import { CreateInvitationDto } from "./dto/create-invitation.dto";
import { AcceptInvitationDto } from "./dto/accept-invitation.dto";

@Controller("invitations")
export class InvitationsController {
  constructor(
    private readonly invitations: InvitationService,
    private readonly abilityFactory: AbilityFactory,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @Audited("Invitation", "invitation")
  async create(
    @Body() dto: CreateInvitationDto,
    @CurrentUser() user: RequestUser,
  ) {
    const ability = this.abilityFactory.createForUser(user);
    if (
      !ability.can(
        "invite",
        subject("Invitation", { invitedRole: dto.invitedRole }),
      )
    ) {
      throw new ForbiddenException(
        "Insufficient permissions to invite this role",
      );
    }

    return this.invitations.create({ ...dto, invitedByUserId: user.id });
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async list(@CurrentUser() user: RequestUser) {
    const ability = this.abilityFactory.createForUser(user);
    if (!ability.can("invite", "Invitation"))
      throw new ForbiddenException("Insufficient permissions");

    return this.invitations.listPending();
  }

  @Patch(":id/resend")
  @UseGuards(JwtAuthGuard)
  @Audited("Invitation", "invitation")
  async resend(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    const ability = this.abilityFactory.createForUser(user);
    if (!ability.can("invite", "Invitation"))
      throw new ForbiddenException("Insufficient permissions");

    return this.invitations.resend(id);
  }

  @Patch(":id/revoke")
  @UseGuards(JwtAuthGuard)
  @Audited("Invitation", "invitation")
  async revoke(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    const ability = this.abilityFactory.createForUser(user);
    if (!ability.can("invite", "Invitation"))
      throw new ForbiddenException("Insufficient permissions");

    return this.invitations.revoke(id);
  }

  /** Public: lets the accept-invite page show who/what the invite is for, and whether a password step is even needed. */
  @Get(":token")
  async peek(@Param("token") token: string) {
    return this.invitations.peek(token);
  }

  // No model — keyed by :token, not :id, and pre-account-creation (no
  // actor yet). The response shape here is a pre-existing thin one ({ id,
  // email } only) — not touched here, out of scope for audit plumbing.
  @Post(":token/accept")
  @HttpCode(HttpStatus.OK)
  @Audited("Invitation")
  async accept(
    @Param("token") token: string,
    @Body() dto: AcceptInvitationDto,
  ) {
    const user = await this.invitations.accept(token, dto.password);
    return { id: user.id, email: user.email };
  }
}
