import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { IdentityModule } from "../identity/identity.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./jwt.strategy";
import { JwtAuthGuard } from "./jwt-auth.guard";

/**
 * Global so `JwtAuthGuard` is usable via `@UseGuards(JwtAuthGuard)` from any
 * module (e.g. IdentityModule's controllers) without that module importing
 * AuthModule back — avoids a circular import, since AuthModule itself
 * imports IdentityModule for UserService (ARCHITECTURE.md §7).
 */
@Global()
@Module({
  imports: [
    IdentityModule,
    NotificationsModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>("JWT_ACCESS_SECRET"),
        signOptions: { expiresIn: "15m" },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, JwtAuthGuard],
  // JwtModule re-exported so NotificationsGateway can inject JwtService
  // directly (same secret/config as JwtStrategy) without a circular import.
  exports: [AuthService, JwtAuthGuard, JwtModule],
})
export class AuthModule {}
