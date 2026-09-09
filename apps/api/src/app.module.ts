import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER } from "@nestjs/core";
import { BullModule } from "@nestjs/bullmq";
import type Redis from "ioredis";
import { LoggerModule } from "nestjs-pino";
import { SentryGlobalFilter, SentryModule } from "@sentry/nestjs/setup";
import { CommonModule } from "./common/common.module";
import { PrismaExceptionFilter } from "./common/prisma-exception.filter";
import { HealthModule } from "./health/health.module";
import { MetricsModule } from "./metrics/metrics.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule, REDIS_CLIENT } from "./redis/redis.module";
import { MailerModule } from "./mailer/mailer.module";
import { CaslModule } from "./casl/casl.module";
import { IdentityModule } from "./identity/identity.module";
import { LegacyImportModule } from "./identity/students/legacy-import/legacy-import.module";
import { AuthModule } from "./auth/auth.module";
import { AcademicStructureModule } from "./academic-structure/academic-structure.module";
import { StaffAssignmentsModule } from "./staff-assignments/staff-assignments.module";
import { SubjectModule } from "./subjects/subject.module";
import { TimetableModule } from "./timetable/timetable.module";
import { AssessmentsModule } from "./assessments/assessments.module";
import { CalendarModule } from "./calendar/calendar.module";
import { AttendanceModule } from "./attendance/attendance.module";
import { ExamSchedulingModule } from "./exam-scheduling/exam-scheduling.module";
import { FeesModule } from "./fees/fees.module";
import { StorageModule } from "./storage/storage.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { PublicInquiriesModule } from "./public-inquiries/public-inquiries.module";
import { AuditModule } from "./audit/audit.module";
import { DashboardModule } from "./dashboard/dashboard.module";

// instrument.ts (imported first in main.ts, before this module) already
// loaded .env by the time this decorator evaluates, so this reads the real
// value — unset means SentryModule/SentryGlobalFilter are left out
// entirely, same as Sentry.init() itself being skipped in instrument.ts.
const sentryEnabled = Boolean(process.env.SENTRY_DSN);

@Module({
  imports: [
    ...(sentryEnabled ? [SentryModule.forRoot()] : []),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ["../../.env", ".env"],
    }),
    // ARCHITECTURE §13: structured logging with per-request correlation
    // IDs. Pretty-printed only outside production so prod stdout stays
    // newline-delimited JSON.
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
          // Trim the default per-request log to just method/url/status —
          // the full req/res objects (headers, query, params, etc.) are
          // noise for local dev and rarely needed once something's wrong.
          serializers: {
            req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },
        },
      }),
    }),
    CommonModule,
    PrismaModule,
    AuditModule,
    RedisModule,
    StorageModule,
    // First producer-side BullMQ usage in apps/api (Phase 4 M4 — Admin-
    // triggered FULL_TERM report generation). Shares RedisModule's REDIS_CLIENT
    // instance rather than opening a new connection per registered queue —
    // BullMQ only reuses a connection when handed an actual ioredis instance
    // (not raw {url} options), which is what was blowing through Render's
    // free-tier 50-connection cap. defaultJobOptions caps job retention so
    // completed/failed job data (previously kept forever) stops filling the
    // 25MB memory limit.
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
    MailerModule,
    CaslModule,
    IdentityModule,
    LegacyImportModule,
    AuthModule,
    AcademicStructureModule,
    StaffAssignmentsModule,
    SubjectModule,
    TimetableModule,
    AssessmentsModule,
    CalendarModule,
    AttendanceModule,
    ExamSchedulingModule,
    FeesModule,
    NotificationsModule,
    PublicInquiriesModule,
    HealthModule,
    MetricsModule,
    DashboardModule,
  ],
  // Nest tries globally-bound APP_FILTERs in reverse registration order, so
  // PrismaExceptionFilter (registered last) gets first look at an exception
  // — mapping a PrismaClientKnownRequestError to a proper HttpException
  // before it ever reaches SentryGlobalFilter's catch-all default handling.
  providers: [
    ...(sentryEnabled ? [{ provide: APP_FILTER, useClass: SentryGlobalFilter }] : []),
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
  ],
})
export class AppModule {}
