import { config } from "dotenv";
import * as Sentry from "@sentry/nestjs";

// Mirrors apps/api/src/instrument.ts — see its comment for why this must be
// imported before anything else in main.ts, and why it re-loads .env even
// though ConfigModule.forRoot() also does (dotenv doesn't overwrite
// already-set process.env values, so calling it twice is harmless).
config({ path: ["../../.env", ".env"] });

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    tracesSampleRate: 1.0,
  });
}
