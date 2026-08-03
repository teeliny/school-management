import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { BullModule } from "@nestjs/bullmq";
import { CommonModule } from "./common/common.module";
import { HealthModule } from "./health/health.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./redis/redis.module";
import { MailerModule } from "./mailer/mailer.module";
import { CaslModule } from "./casl/casl.module";
import { IdentityModule } from "./identity/identity.module";
import { AuthModule } from "./auth/auth.module";
import { AcademicStructureModule } from "./academic-structure/academic-structure.module";
import { StaffAssignmentsModule } from "./staff-assignments/staff-assignments.module";
import { SubjectModule } from "./subjects/subject.module";
import { TimetableModule } from "./timetable/timetable.module";
import { AssessmentsModule } from "./assessments/assessments.module";
import { CalendarModule } from "./calendar/calendar.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ["../../.env", ".env"],
    }),
    CommonModule,
    PrismaModule,
    RedisModule,
    // First producer-side BullMQ usage in apps/api (Phase 4 M4 — Admin-
    // triggered FULL_TERM report generation). Connection config duplicated
    // from apps/worker's own BullModule.forRootAsync, same REDIS_URL env var
    // — same duplication-not-sharing precedent as parseCorsOrigins().
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.getOrThrow<string>("REDIS_URL") },
      }),
    }),
    MailerModule,
    CaslModule,
    IdentityModule,
    AuthModule,
    AcademicStructureModule,
    StaffAssignmentsModule,
    SubjectModule,
    TimetableModule,
    AssessmentsModule,
    CalendarModule,
    HealthModule,
  ],
})
export class AppModule {}
