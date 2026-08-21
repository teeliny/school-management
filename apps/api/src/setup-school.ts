import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { SetupService } from "./identity/setup/setup";

/**
 * The one application-specific piece of standing up a new school's
 * deployment (ARCHITECTURE.md §6.1) — everything before this (provisioning a
 * database, setting env config, deploying, running migrations) is ordinary
 * infrastructure work outside this script's concern. `SetupController`
 * (identity/setup/setup.ts) is the HTTP alternative to this script, for
 * infra without shell/exec access to run it; both share `SetupService`.
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
  const setupService = app.get(SetupService);

  try {
    const result = await setupService.bootstrapSchool(args);
    switch (result.status) {
      case "already_active":
        logger.log(`${result.email} is already an active Super-Admin — nothing to do.`);
        break;
      case "resent":
        logger.log(`A pending Super-Admin invitation for ${result.email} already existed — resent it.`);
        break;
      case "invited":
        logger.log(`Invited ${result.email} as Super-Admin (Proprietor).`);
        break;
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
