import { z } from "zod";

/**
 * Shared shape for every service's /health endpoint (api, worker).
 * BUILD_PLAN.md §11.1 / ARCHITECTURE.md §13: checks each live dependency
 * (DB, Redis, Resend, the active payment gateway) rather than the Phase 0
 * bare-uptime stub. "skipped" covers the two legitimate non-error states —
 * RESEND_API_KEY unset, or no PaymentGatewayConfig row marked isActive yet.
 */
export const healthCheckSchema = z.object({
  name: z.enum(["database", "redis", "resend", "paymentGateway"]),
  status: z.enum(["ok", "error", "skipped"]),
  latencyMs: z.number().optional(),
  detail: z.string().optional(),
});

export const healthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  service: z.string(),
  checks: z.array(healthCheckSchema),
});

export type HealthCheck = z.infer<typeof healthCheckSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
