import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type Redis from "ioredis";
import type { HealthCheck, HealthResponse } from "@school/types";
import { MONNIFY_BASE_URLS, PAYSTACK_BASE_URL } from "@school/types/payment-gateways";
import { PrismaService } from "../prisma/prisma.service";
import { REDIS_CLIENT } from "../redis/redis.module";

const CHECK_TIMEOUT_MS = 3000;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]);
}

/**
 * ARCHITECTURE.md §13: real dependency checks, replacing the Phase 0
 * bare-uptime stub. Each check is independently timed out and never throws
 * out of this service — a failing dependency shows up as one "error" entry,
 * not a 500 from /health itself.
 */
@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async check(): Promise<HealthResponse> {
    const checks = await Promise.all([this.checkDatabase(), this.checkRedis(), this.checkResend(), this.checkPaymentGateway()]);
    const status = checks.some((c) => c.status === "error") ? "degraded" : "ok";
    return { status, service: "api", checks };
  }

  private async checkDatabase(): Promise<HealthCheck> {
    return this.timed("database", async () => {
      await this.prisma.$queryRaw`SELECT 1`;
    });
  }

  private async checkRedis(): Promise<HealthCheck> {
    return this.timed("redis", async () => {
      await this.redis.ping();
    });
  }

  private async checkResend(): Promise<HealthCheck> {
    const apiKey = this.config.get<string>("RESEND_API_KEY");
    if (!apiKey) return { name: "resend", status: "skipped", detail: "RESEND_API_KEY not set" };
    return this.timed("resend", async () => {
      // Any HTTP response (even 401/403) proves reachability — this is a
      // network check, not a credential-validity check.
      await fetch("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
    });
  }

  private async checkPaymentGateway(): Promise<HealthCheck> {
    const active = await this.prisma.paymentGatewayConfig.findFirst({ where: { isActive: true } });
    if (!active) return { name: "paymentGateway", status: "skipped", detail: "no active PaymentGatewayConfig" };
    const baseUrl = active.provider === "PAYSTACK" ? PAYSTACK_BASE_URL : MONNIFY_BASE_URLS[active.environment];
    return this.timed("paymentGateway", async () => {
      await fetch(baseUrl, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
    });
  }

  private async timed(name: HealthCheck["name"], fn: () => Promise<void>): Promise<HealthCheck> {
    const start = Date.now();
    try {
      await withTimeout(fn(), CHECK_TIMEOUT_MS);
      return { name, status: "ok", latencyMs: Date.now() - start };
    } catch (error) {
      return { name, status: "error", latencyMs: Date.now() - start, detail: String(error instanceof Error ? error.message : error) };
    }
  }
}
