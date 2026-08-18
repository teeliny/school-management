import { config } from "dotenv";
import * as Sentry from "@sentry/nestjs";

// Must be imported before anything else in main.ts (Sentry's own Nest
// integration requirement — instrumentation has to be registered before
// the modules it instruments are loaded). Same envFilePath fallback list as
// ConfigModule.forRoot() in app.module.ts (resolved relative to cwd, same
// as dotenv resolves any relative `path` option) — this file runs before
// Nest's own ConfigModule has had a chance to load .env, so it loads it
// again itself; dotenv is idempotent about not overwriting already-set
// process.env values.
config({ path: ["../../.env", ".env"] });

// SENTRY_DSN unset => Sentry.init is never called => no-op, same
// optional-dependency fallback shape as MailerService's RESEND_API_KEY
// (apps/api/src/mailer/mailer.service.ts).
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    tracesSampleRate: 1.0,
  });
}
