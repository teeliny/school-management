import { ConfigService } from "@nestjs/config";

/**
 * The browser calls this API cross-origin (web app on :3000, API on :3001 in
 * dev), so it needs to be an explicit CORS allow-list, not the default
 * same-origin-only behavior. `CORS_ORIGIN` is a comma-separated list; falls
 * back to `WEB_BASE_URL` (already configured for building email links) so
 * there's a sensible default without a second env var to set in dev.
 */
export function parseCorsOrigins(config: ConfigService): string[] {
  const raw =
    config.get<string>("CORS_ORIGIN") ?? config.get<string>("WEB_BASE_URL") ?? "http://localhost:3000";
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
