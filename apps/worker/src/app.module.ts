import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER } from "@nestjs/core";
import { BullModule } from "@nestjs/bullmq";
import type Redis from "ioredis";
import { LoggerModule } from "nestjs-pino";
import { SentryGlobalFilter, SentryModule } from "@sentry/nestjs/setup";
import { HealthModule } from "./health/health.module";
import { MetricsModule } from "./metrics/metrics.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule, REDIS_CLIENT } from "./redis/redis.module";
import { StorageModule } from "./storage/storage.module";
import { AssessmentSweepModule } from "./assessment-sweep/assessment-sweep.module";
import { ReportCardModule } from "./report-card/report-card.module";
import { ReceiptModule } from "./receipt/receipt.module";
import { PaymentReconciliationModule } from "./payment-reconciliation/payment-reconciliation.module";
import { EmailModule } from "./email/email.module";
import { InvoiceOverdueSweepModule } from "./invoice-overdue-sweep/invoice-overdue-sweep.module";
import { SchedulingSolveDispatchModule } from "./scheduling-solve-dispatch/scheduling-solve-dispatch.module";
import { SchedulingTimeoutSweepModule } from "./scheduling-timeout-sweep/scheduling-timeout-sweep.module";
import { AuditLogRetentionModule } from "./audit-log-retention/audit-log-retention.module";

// instrument.ts (imported first in main.ts, before this module) already
// loaded .env by the time this decorator evaluates — see
// apps/api/src/app.module.ts's identical comment for the full reasoning.
const sentryEnabled = Boolean(process.env.SENTRY_DSN);

// First real BullMQ consumer module (Phase 4, docs/ARCHITECTURE.md §8) — the
// connection config is duplicated from apps/api/src/redis/redis.module.ts's
// REDIS_URL env var rather than shared, same precedent as parseCorsOrigins().
@Module({
  imports: [
    ...(sentryEnabled ? [SentryModule.forRoot()] : []),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ["../../.env", ".env"],
    }),
    LoggerModule.forRootAsync({
      useFactory: () => ({
        pinoHttp: {
          level: process.env.NODE_ENV === "production" ? "info" : "debug",
          transport:
            process.env.NODE_ENV === "production" ? undefined : { target: "pino-pretty", options: { singleLine: true } },
          redact: ["req.headers.authorization", "req.body.password", "req.body.token", "req.body.secretKey", "req.body.apiKey"],
          genReqId: (req: IncomingMessage, res: ServerResponse) => {
            const existing = req.headers["x-request-id"];
            const id = typeof existing === "string" ? existing : randomUUID();
            res.setHeader("X-Request-Id", id);
            return id;
          },
        },
      }),
    }),
    PrismaModule,
    RedisModule,
    // Shares RedisModule's REDIS_CLIENT instance rather than opening a new
    // connection per registered queue/worker — BullMQ only reuses a
    // connection when handed an actual ioredis instance (not raw {url}
    // options), which is what was blowing through Render's free-tier
    // 50-connection cap (10 queues + their Workers here alone). Workers
    // still each open one dedicated blocking connection internally — that
    // part of BullMQ can't be shared — but this removes the redundant
    // producer-side connection each registerQueue() used to open too.
    // defaultJobOptions caps job retention so completed/failed job data
    // (previously kept forever) stops filling the 25MB memory limit.
    BullModule.forRootAsync({
      inject: [REDIS_CLIENT],
      useFactory: (redis: Redis) => ({
        connection: redis,
        defaultJobOptions: {
          removeOnComplete: { count: 500 },
          removeOnFail: { count: 2000 },
        },
      }),
    }),
    StorageModule,
    AssessmentSweepModule,
    ReportCardModule,
    ReceiptModule,
    PaymentReconciliationModule,
    EmailModule,
    InvoiceOverdueSweepModule,
    SchedulingSolveDispatchModule,
    SchedulingTimeoutSweepModule,
    AuditLogRetentionModule,
    HealthModule,
    MetricsModule,
  ],
  providers: [...(sentryEnabled ? [{ provide: APP_FILTER, useClass: SentryGlobalFilter }] : [])],
})
export class AppModule {}
