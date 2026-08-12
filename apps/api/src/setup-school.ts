import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Role } from "@prisma/client";
import { DEFAULT_NOTIFICATION_TEMPLATES, DEFAULT_SCHEDULING_CONSTRAINTS } from "@school/types";
import { AppModule } from "./app.module";
import { PrismaService } from "./prisma/prisma.service";
import { InvitationService } from "./identity/invitations/invitation.service";

/**
 * The one application-specific piece of standing up a new school's
 * deployment (ARCHITECTURE.md §6.1) — everything before this (provisioning a
 * database, setting env config, deploying, running migrations) is ordinary
 * infrastructure work outside this script's concern.
 *
 * Usage:
 *   pnpm setup:school \
 *     --school-name="Example Secondary School" \
 *     --proprietor-email=proprietor@example.com \
 *     --proprietor-first-name=Ada \
 *     --proprietor-last-name=Lovelace
 *
 * Safe to re-run: it checks what already exists before creating anything, so
 * a partial failure can just be retried (ARCHITECTURE.md §6.1).
 */

interface Args {
  schoolName: string;
  proprietorEmail: string;
  proprietorFirstName: string;
  proprietorLastName: string;
}

function parseArgs(argv: string[]): Args {
  const values = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    const [, key, value] = match ?? [];
    if (key && value !== undefined) values.set(key, value);
  }

  const schoolName = values.get("school-name");
  const proprietorEmail = values.get("proprietor-email");
  const proprietorFirstName = values.get("proprietor-first-name");
  const proprietorLastName = values.get("proprietor-last-name");

  if (
    !schoolName ||
    !proprietorEmail ||
    !proprietorFirstName ||
    !proprietorLastName
  ) {
    throw new Error(
      "Usage: pnpm setup:school --school-name=... --proprietor-email=... " +
        "--proprietor-first-name=... --proprietor-last-name=...",
    );
  }

  return {
    schoolName,
    proprietorEmail,
    proprietorFirstName,
    proprietorLastName,
  };
}

async function main() {
  const logger = new Logger("setup:school");
  const args = parseArgs(process.argv.slice(2));

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });
  const prisma = app.get(PrismaService);
  const invitations = app.get(InvitationService);

  try {
    const existingProfile = await prisma.schoolProfile.findFirst();
    if (existingProfile) {
      logger.log(
        `School profile already exists ("${existingProfile.name}") — skipping creation.`,
      );
    } else {
      await prisma.schoolProfile.create({ data: { name: args.schoolName } });
      logger.log(`Created school profile "${args.schoolName}".`);
    }

    // PRD §3.10, BUILD_PLAN.md §8 item 2: seed each NotificationType's
    // default copy exactly once — `update: {}` means a re-run never
    // clobbers an Admin's prior customization, same "safe to re-run"
    // contract as the rest of this script.
    for (const template of DEFAULT_NOTIFICATION_TEMPLATES) {
      await prisma.notificationTemplate.upsert({
        where: { key: template.key },
        update: {},
        create: template,
      });
    }
    logger.log(`Ensured ${DEFAULT_NOTIFICATION_TEMPLATES.length} default notification templates exist.`);

    // BUILD_PLAN.md §9 Step 1, PRD §3.8: seed SchedulingConstraint defaults
    // exactly once per (scope, key) — same idempotent upsert-with-`update:
    // {}` pattern as notification templates, so a re-run never clobbers an
    // Admin's prior tuning of these values.
    for (const constraint of DEFAULT_SCHEDULING_CONSTRAINTS) {
      await prisma.schedulingConstraint.upsert({
        where: { scope_key: { scope: constraint.scope, key: constraint.key } },
        update: {},
        create: constraint,
      });
    }
    logger.log(`Ensured ${DEFAULT_SCHEDULING_CONSTRAINTS.length} default scheduling constraints exist.`);

    const email = args.proprietorEmail.trim().toLowerCase();
    const existingUser = await prisma.user.findUnique({
      where: { email },
      include: { roles: true },
    });
    const alreadyActiveSuperAdmin = existingUser?.roles.some(
      (r) => r.role === Role.SUPER_ADMIN && r.isActive,
    );

    if (alreadyActiveSuperAdmin) {
      logger.log(`${email} is already an active Super-Admin — nothing to do.`);
      return;
    }

    const pendingInvite = await prisma.invitation.findFirst({
      where: { email, invitedRole: Role.SUPER_ADMIN, status: "PENDING" },
    });

    if (pendingInvite) {
      await invitations.resend(pendingInvite.id);
      logger.log(
        `A pending Super-Admin invitation for ${email} already existed — resent it.`,
      );
    } else {
      await invitations.create({
        email,
        firstName: args.proprietorFirstName,
        lastName: args.proprietorLastName,
        invitedRole: Role.SUPER_ADMIN,
        invitedByUserId: null,
      });
      logger.log(`Invited ${email} as Super-Admin (Proprietor).`);
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
