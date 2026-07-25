import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { HealthModule } from "./health/health.module";

// NOTE: this is the worker's own module tree for now. Once real BullMQ
// consumer modules exist (Phase 1+ — email, report-card-generation, etc.,
// docs/ARCHITECTURE.md §8), they should live in a shared internal lib imported by
// both apps/api and apps/worker (docs/ARCHITECTURE.md §4), not duplicated here.
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ["../../.env", ".env"],
    }),
    HealthModule,
  ],
})
export class AppModule {}
