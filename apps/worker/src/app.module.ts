import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_FILTER } from "@nestjs/core";
import { BullModule } from "@nestjs/bullmq";
import { LoggerModule } from "nestjs-pino";
import { SentryGlobalFilter, SentryModule } from "@sentry/nestjs/setup";
import { HealthModule } from "./health/health.module";
import { MetricsModule } from "./metrics/metrics.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./redis/redis.module";
import { StorageModule } from "./storage/storage.module";
import { AssessmentSweepModule } from "./assessment-sweep/assessment-sweep.module";
import { ReportCardModule } from "./report-card/report-card.module";
import { ReceiptModule } from "./receipt/receipt.module";
import { PaymentReconciliationModule } from "./payment-reconciliation/payment-reconciliation.module";
import { EmailModule } from "./email/email.module";
import { InvoiceOverdueSweepModule } from "./invoice-overdue-sweep/invoice-overdue-sweep.module";
import { SchedulingSolveDispatchModule } from "./scheduling-solve-dispatch/scheduling-solve-dispatch.module";
import { SchedulingTimeoutSweepModule } from "./scheduling-timeout-sweep/scheduling-timeout-sweep.module";

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
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.getOrThrow<string>("REDIS_URL") },
      }),
    }),
    PrismaModule,
    RedisModule,
    StorageModule,
    AssessmentSweepModule,
    ReportCardModule,
    ReceiptModule,
    PaymentReconciliationModule,
    EmailModule,
    InvoiceOverdueSweepModule,
    SchedulingSolveDispatchModule,
    SchedulingTimeoutSweepModule,
    HealthModule,
    MetricsModule,
  ],
  providers: [...(sentryEnabled ? [{ provide: APP_FILTER, useClass: SentryGlobalFilter }] : [])],
})
export class AppModule {}
