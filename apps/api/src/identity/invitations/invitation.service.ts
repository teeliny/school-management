import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  Invitation,
  InvitationStatus,
  Role,
  StaffCategory,
} from "@prisma/client";
import * as argon2 from "argon2";
import { PrismaService } from "../../prisma/prisma.service";
import { MailerService } from "../../mailer/mailer.service";
import { generateRawToken, hashToken } from "../../common/crypto/token";
import { UserService } from "../users/user.service";

const DEFAULT_EXPIRY_DAYS = 7;

export interface CreateInvitationInput {
  email: string;
  firstName: string;
  lastName: string;
  invitedRole: Role;
  staffCategory?: StaffCategory;
  invitedByUserId?: string | null;
}

@Injectable()
export class InvitationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Creates the User (status `invited`) + Invitation row together (PRD FR1.2),
   * then emails the accept link. `invitedByUserId` is null only for the very
   * first SUPER_ADMIN invite, created by `pnpm setup:school` before any User
   * exists to be the sender (PRD §3.1a).
   */
  async create(input: CreateInvitationInput): Promise<Invitation> {
    const email = UserService.normalizeEmail(input.email);
    const rawToken = generateRawToken();
    const expiresAt = new Date(
      Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );

    const invitation = await this.prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({ where: { email } });
      if (!existingUser) {
        await tx.user.create({
          data: { email, firstName: input.firstName, lastName: input.lastName },
        });
      }

      return tx.invitation.create({
        data: {
          email,
          invitedRole: input.invitedRole,
          staffCategory: input.staffCategory,
          invitedByUserId: input.invitedByUserId ?? null,
          tokenHash: hashToken(rawToken),
          expiresAt,
        },
      });
    });

    await this.sendInviteEmail(email, rawToken);
    return invitation;
  }

  /** Public lookup for the accept-invite page — no auth, since the caller isn't logged in yet. */
  findByRawToken(rawToken: string): Promise<Invitation | null> {
    return this.prisma.invitation.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });
  }

  /**
   * PRD FR1.2/§3.1a: single-use accept flow. Validates the token, sets the
   * password, activates the User, grants the invited role, and marks the
   * Invitation ACCEPTED — all inside one transaction.
   */
  async accept(rawToken: string, password: string) {
    const tokenHash = hashToken(rawToken);
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash },
    });

    if (!invitation) throw new NotFoundException("Invitation not found");
    if (invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException(
        `Invitation is ${invitation.status.toLowerCase()}, not pending`,
      );
    }
    if (invitation.expiresAt < new Date()) {
      throw new BadRequestException("Invitation has expired");
    }

    const passwordHash = await argon2.hash(password);

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { email: invitation.email },
      });
      if (!user)
        throw new NotFoundException("No account found for this invitation");

      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, status: "active" },
      });

      const existingRole = await tx.userRole.findFirst({
        where: { userId: user.id, role: invitation.invitedRole },
      });
      if (existingRole) {
        await tx.userRole.update({
          where: { id: existingRole.id },
          data: { isActive: true },
        });
      } else {
        await tx.userRole.create({
          data: { userId: user.id, role: invitation.invitedRole },
        });
      }

      await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.ACCEPTED, acceptedAt: new Date() },
      });

      return user;
    });
  }

  /** PRD FR1.4: PENDING/EXPIRED invites, for the Super-Admin/Admin pending-invitations view. */
  listPending() {
    return this.prisma.invitation.findMany({
      where: {
        status: { in: [InvitationStatus.PENDING, InvitationStatus.EXPIRED] },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /** Issues a new token, invalidating the old one (PRD FR1.4), and re-sends the email. */
  async resend(invitationId: string): Promise<Invitation> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { id: invitationId },
    });

    if (!invitation) throw new NotFoundException("Invitation not found");
    if (invitation.status === InvitationStatus.ACCEPTED) {
      throw new BadRequestException("Invitation was already accepted");
    }

    const rawToken = generateRawToken();
    const updated = await this.prisma.invitation.update({
      where: { id: invitationId },
      data: {
        tokenHash: hashToken(rawToken),
        status: InvitationStatus.PENDING,
        expiresAt: new Date(
          Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
        ),
      },
    });

    await this.sendInviteEmail(invitation.email, rawToken);
    console.log("invite sent");
    return updated;
  }

  async revoke(invitationId: string): Promise<Invitation> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { id: invitationId },
    });
    if (!invitation) throw new NotFoundException("Invitation not found");
    if (invitation.status === InvitationStatus.ACCEPTED) {
      throw new BadRequestException("Invitation was already accepted");
    }

    return this.prisma.invitation.update({
      where: { id: invitationId },
      data: { status: InvitationStatus.REVOKED },
    });
  }

  private async sendInviteEmail(email: string, rawToken: string) {
    const webBaseUrl =
      this.config.get<string>("WEB_BASE_URL") ?? "http://localhost:3000";
    const acceptUrl = `${webBaseUrl}/accept-invite?token=${rawToken}`;
    console.log(acceptUrl, "url");

    await this.mailer.send({
      to: email,
      subject: "You've been invited",
      html: `<p>You've been invited to join your school's account.</p><p><a href="${acceptUrl}">Accept your invitation</a></p><p>This link expires in ${DEFAULT_EXPIRY_DAYS} days.</p>`,
    });
  }
}
