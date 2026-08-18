import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  Invitation,
  InvitationStatus,
  Prisma,
  Role,
  StaffCategory,
} from "@prisma/client";
import * as argon2 from "argon2";
import { PrismaService } from "../../prisma/prisma.service";
import { MailerService } from "../../mailer/mailer.service";
import { generateRawToken, hashToken } from "../../common/crypto/token";
import { UserService } from "../users/user.service";

const DEFAULT_EXPIRY_DAYS = 7;

type Tx = Prisma.TransactionClient;

export interface CreateInvitationInput {
  email: string;
  firstName: string;
  lastName: string;
  invitedRole: Role;
  staffCategory?: StaffCategory;
  invitedByUserId?: string | null;
}

export interface CreateInvitationResult {
  invitation: Invitation;
  rawToken: string;
  userId: string;
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
    const { invitation, rawToken } = await this.prisma.$transaction((tx) =>
      this.createInTx(tx, input),
    );
    await this.sendInviteEmail(invitation.email, rawToken);
    return invitation;
  }

  /**
   * The transaction-composable core of invite creation: User + Invitation +
   * a role-appropriate profile shell (Admin/Staff/ParentProfile), all in the
   * caller's transaction. Split out from `create()` so `StudentService` can
   * inline-invite a new parent (PRD FR1.3) inside its own atomic
   * student-creation transaction instead of nesting `$transaction` calls.
   * Callers own sending the email (via `sendInviteEmail`) after their
   * transaction commits — email failure shouldn't roll back a real DB write.
   */
  async createInTx(
    tx: Tx,
    input: CreateInvitationInput,
  ): Promise<CreateInvitationResult> {
    const email = UserService.normalizeEmail(input.email);
    const rawToken = generateRawToken();
    const expiresAt = new Date(
      Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );

    let user = await tx.user.findUnique({ where: { email } });
    if (!user) {
      user = await tx.user.create({
        data: { email, firstName: input.firstName, lastName: input.lastName },
      });
    }

    await this.ensureProfileShell(
      tx,
      user.id,
      input.invitedRole,
      input.staffCategory,
    );

    const invitation = await tx.invitation.create({
      data: {
        email,
        invitedRole: input.invitedRole,
        staffCategory: input.staffCategory,
        invitedByUserId: input.invitedByUserId ?? null,
        tokenHash: hashToken(rawToken),
        expiresAt,
      },
    });

    return { invitation, rawToken, userId: user.id };
  }

  /**
   * Role-shell profile rows are created at invite time, not accept time —
   * required so e.g. a StudentGuardian row (FK -> ParentProfile) can link to
   * an inline-invited parent immediately, before they've accepted anything
   * (PRD FR1.3). AdminProfile backs both SUPER_ADMIN and ADMIN — there's no
   * separate SuperAdminProfile table (PRD §4: one profile type per UserRole).
   * No-op if the profile already exists (re-invite, or a user gaining an
   * additional role per FR1.5).
   */
  private async ensureProfileShell(
    tx: Tx,
    userId: string,
    role: Role,
    staffCategory?: StaffCategory,
  ): Promise<void> {
    switch (role) {
      case Role.SUPER_ADMIN:
      case Role.ADMIN: {
        const existing = await tx.adminProfile.findUnique({
          where: { userId },
        });
        if (!existing) await tx.adminProfile.create({ data: { userId } });
        return;
      }
      case Role.STAFF: {
        const existing = await tx.staffProfile.findUnique({
          where: { userId },
        });
        if (!existing)
          await tx.staffProfile.create({ data: { userId, staffCategory } });
        return;
      }
      case Role.PARENT: {
        const existing = await tx.parentProfile.findUnique({
          where: { userId },
        });
        if (!existing) await tx.parentProfile.create({ data: { userId } });
        return;
      }
      case Role.STUDENT:
        // Students are never invited (PRD FR1.3) — nothing to seed here.
        return;
    }
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

  /** Public so callers composing their own transaction (e.g. StudentService's inline parent invite) can send post-commit. */
  async sendInviteEmail(email: string, rawToken: string) {
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
