import { ConfigService } from "@nestjs/config";

/**
 * Same rationale as apps/api/src/common/cors.ts — duplicated rather than
 * shared for now, matching the note in app.module.ts about real shared code
 * moving to an internal lib once it exists (ARCHITECTURE.md §4). The worker
 * only serves /health today, but gets the same CORS treatment as api/
 * scheduling-engine so it isn't a surprise gap later.
 */
export function parseCorsOrigins(config: ConfigService): string[] {
  const raw =
    config.get<string>("CORS_ORIGIN") ?? config.get<string>("WEB_BASE_URL") ?? "http://localhost:3000";
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
