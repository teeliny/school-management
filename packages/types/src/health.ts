import { z } from "zod";

/**
 * Shared shape for every service's /health endpoint (api, worker, scheduling-engine).
 * Kept intentionally minimal in Phase 0 — no dependency checks wired up yet.
 */
export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
