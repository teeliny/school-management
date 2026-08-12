import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { BullModule } from "@nestjs/bullmq";
import { HealthModule } from "./health/health.module";
import { PrismaModule } from "./prisma/prisma.module";
import { StorageModule } from "./storage/storage.module";
import { AssessmentSweepModule } from "./assessment-sweep/assessment-sweep.module";
import { ReportCardModule } from "./report-card/report-card.module";
import { ReceiptModule } from "./receipt/receipt.module";
import { PaymentReconciliationModule } from "./payment-reconciliation/payment-reconciliation.module";
import { EmailModule } from "./email/email.module";
import { InvoiceOverdueSweepModule } from "./invoice-overdue-sweep/invoice-overdue-sweep.module";
import { SchedulingSolveDispatchModule } from "./scheduling-solve-dispatch/scheduling-solve-dispatch.module";
import { SchedulingTimeoutSweepModule } from "./scheduling-timeout-sweep/scheduling-timeout-sweep.module";

// First real BullMQ consumer module (Phase 4, docs/ARCHITECTURE.md §8) — the
// connection config is duplicated from apps/api/src/redis/redis.module.ts's
// REDIS_URL env var rather than shared, same precedent as parseCorsOrigins().
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ["../../.env", ".env"],
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.getOrThrow<string>("REDIS_URL") },
      }),
    }),
    PrismaModule,
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
  ],
})
export class AppModule {}
