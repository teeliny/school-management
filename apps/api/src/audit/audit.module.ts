import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { AuditInterceptor } from "./audit.interceptor";

/**
 * ARCHITECTURE §5: "AuditModule is intentionally cross-cutting (a Nest
 * interceptor, not something other modules import and call)." Registering
 * AuditInterceptor as a global APP_INTERCEPTOR here is what makes every
 * `@Audited(...)`-decorated handler across the app get logged without any
 * controller adding `@UseInterceptors(AuditInterceptor)` itself.
 */
@Global()
@Module({
  providers: [{ provide: APP_INTERCEPTOR, useClass: AuditInterceptor }],
})
export class AuditModule {}
