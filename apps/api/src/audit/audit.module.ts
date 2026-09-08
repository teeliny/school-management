import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { AuditInterceptor } from "./audit.interceptor";
import { AuditLogController, AuditLogService } from "./audit-log";

/**
 * ARCHITECTURE §5: "AuditModule is intentionally cross-cutting (a Nest
 * interceptor, not something other modules import and call)." Registering
 * AuditInterceptor as a global APP_INTERCEPTOR here is what makes every
 * `@Audited(...)`-decorated handler across the app get logged without any
 * controller adding `@UseInterceptors(AuditInterceptor)` itself.
 *
 * AuditLogController/Service (the read side) live in this same module,
 * despite not being cross-cutting themselves, since they're the one other
 * thing that touches the AuditLog table directly.
 */
@Global()
@Module({
  controllers: [AuditLogController],
  providers: [{ provide: APP_INTERCEPTOR, useClass: AuditInterceptor }, AuditLogService],
})
export class AuditModule {}
