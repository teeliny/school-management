import { Body, Controller, ForbiddenException, HttpCode, HttpStatus, Injectable, Logger, Post } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Role } from "@prisma/client";
import { DEFAULT_NOTIFICATION_TEMPLATES, DEFAULT_SCHEDULING_CONSTRAINTS } from "@school/types";
import { PrismaService } from "../../prisma/prisma.service";
import { InvitationService } from "../invitations/invitation.service";
import { UserService } from "../users/user.service";
import { Audited } from "../../audit/audited.decorator";
import { BootstrapSuperAdminDto } from "./dto/bootstrap-super-admin.dto";

export interface BootstrapSchoolArgs {
  schoolName: string;
  proprietorEmail: string;
  proprietorFirstName: string;
  proprietorLastName: string;
}

export type BootstrapSchoolStatus = "invited" | "resent" | "already_active";

/**
 * `SETUP_ALLOWED_EMAILS` (comma-separated, ARCHITECTURE.md §6.1) — the
 * infra-level allowlist gating `SetupController.bootstrapSuperAdmin`.
 * Same split/trim/filter shape as `parseCorsOrigins` (common/cors.ts); kept
 * here rather than shared since it has the one caller.
 */
export function parseSetupAllowedEmails(config: ConfigService): string[] {
  const raw = config.get<string>("SETUP_ALLOWED_EMAILS") ?? "";
  return raw
    .split(",")
    .map((email) => UserService.normalizeEmail(email))
    .filter(Boolean);
}

/**
 * The one application-specific piece of standing up a new school's
 * deployment (ARCHITECTURE.md §6.1) — shared by `setup-school.ts` (the
 * original CLI entry point) and `SetupController` (the HTTP alternative for
 * infra where a one-off shell command isn't available). Safe to re-run:
 * checks what already exists before creating anything.
 */
@Injectable()
export class SetupService {
  private readonly logger = new Logger(SetupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invitations: InvitationService,
  ) {}

  async hasActiveSuperAdmin(): Promise<boolean> {
    const existing = await this.prisma.userRole.findFirst({
      where: { role: Role.SUPER_ADMIN, isActive: true },
    });
    return existing !== null;
  }

  async bootstrapSchool(args: BootstrapSchoolArgs): Promise<{ status: BootstrapSchoolStatus; email: string }> {
    const existingProfile = await this.prisma.schoolProfile.findFirst();
    if (existingProfile) {
      this.logger.log(`School profile already exists ("${existingProfile.name}") — skipping creation.`);
    } else {
      await this.prisma.schoolProfile.create({ data: { name: args.schoolName } });
      this.logger.log(`Created school profile "${args.schoolName}".`);
    }

    // PRD §3.10, BUILD_PLAN.md §8 item 2: seed each NotificationType's
    // default copy exactly once — `update: {}` means a re-run never
    // clobbers an Admin's prior customization.
    for (const template of DEFAULT_NOTIFICATION_TEMPLATES) {
      await this.prisma.notificationTemplate.upsert({
        where: { key: template.key },
        update: {},
        create: template,
      });
    }
    this.logger.log(`Ensured ${DEFAULT_NOTIFICATION_TEMPLATES.length} default notification templates exist.`);

    // BUILD_PLAN.md §9 Steps 1/2, PRD §3.8: same idempotent seeding intent
    // as notification templates, but the null-classLevelCategoryGroup rows
    // can't go through a typed .upsert() — see setup-school.ts's original
    // comment / CLAUDE.md's StaffAssignment precedent for why.
    for (const constraint of DEFAULT_SCHEDULING_CONSTRAINTS) {
      if (constraint.classLevelCategoryGroup) {
        await this.prisma.schedulingConstraint.upsert({
          where: {
            scope_classLevelCategoryGroup_key: {
              scope: constraint.scope,
              classLevelCategoryGroup: constraint.classLevelCategoryGroup,
              key: constraint.key,
            },
          },
          update: {},
          create: constraint,
        });
        continue;
      }

      const existing = await this.prisma.schedulingConstraint.findFirst({
        where: { scope: constraint.scope, classLevelCategoryGroup: null, key: constraint.key },
      });
      if (!existing) {
        await this.prisma.schedulingConstraint.create({ data: constraint });
      }
    }
    this.logger.log(`Ensured ${DEFAULT_SCHEDULING_CONSTRAINTS.length} default scheduling constraints exist.`);

    const email = UserService.normalizeEmail(args.proprietorEmail);
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      include: { roles: true },
    });
    const alreadyActiveSuperAdmin = existingUser?.roles.some(
      (r) => r.role === Role.SUPER_ADMIN && r.isActive,
    );

    if (alreadyActiveSuperAdmin) {
      return { status: "already_active", email };
    }

    const pendingInvite = await this.prisma.invitation.findFirst({
      where: { email, invitedRole: Role.SUPER_ADMIN, status: "PENDING" },
    });

    if (pendingInvite) {
      await this.invitations.resend(pendingInvite.id);
      return { status: "resent", email };
    }

    await this.invitations.create({
      email,
      firstName: args.proprietorFirstName,
      lastName: args.proprietorLastName,
      invitedRole: Role.SUPER_ADMIN,
      invitedByUserId: null,
    });
    return { status: "invited", email };
  }
}

/**
 * HTTP alternative to `pnpm setup:school` (ARCHITECTURE.md §6.1) for infra
 * without shell/exec access to run the CLI script. Deliberately
 * unauthenticated — there's no account yet for this deployment to
 * authenticate as — so it's gated by two independent checks instead of a
 * JWT guard:
 *
 *  1. `SETUP_ALLOWED_EMAILS`: the proprietor email must be on an
 *     infra-owned allowlist, checked before anything else runs.
 *  2. Once any Super-Admin is active, this route hard-disables itself
 *     (unlike the CLI script, which stays re-runnable) — defense-in-depth
 *     for a route that has no guard and stays live indefinitely. Recovery
 *     after that point goes back through `pnpm setup:school`.
 */
@Controller("setup")
export class SetupController {
  constructor(
    private readonly setupService: SetupService,
    private readonly config: ConfigService,
  ) {}

  @Post("super-admin")
  @HttpCode(HttpStatus.OK)
  @Audited("Invitation")
  async bootstrapSuperAdmin(@Body() dto: BootstrapSuperAdminDto) {
    const allowedEmails = parseSetupAllowedEmails(this.config);
    const email = UserService.normalizeEmail(dto.proprietorEmail);

    if (allowedEmails.length === 0 || !allowedEmails.includes(email)) {
      throw new ForbiddenException("Not permitted to set up this deployment.");
    }

    if (await this.setupService.hasActiveSuperAdmin()) {
      throw new ForbiddenException("Setup has already been completed for this deployment.");
    }

    return this.setupService.bootstrapSchool({
      schoolName: dto.schoolName,
      proprietorEmail: dto.proprietorEmail,
      proprietorFirstName: dto.proprietorFirstName,
      proprietorLastName: dto.proprietorLastName,
    });
  }
}
