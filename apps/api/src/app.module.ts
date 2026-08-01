import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ["../../.env", ".env"],
    }),
    CommonModule,
    PrismaModule,
    RedisModule,
    MailerModule,
    CaslModule,
    IdentityModule,
    AuthModule,
    AcademicStructureModule,
    StaffAssignmentsModule,
    HealthModule,
  ],
})
export class AppModule {}
