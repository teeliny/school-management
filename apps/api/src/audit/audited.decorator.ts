import { SetMetadata } from "@nestjs/common";

/**
 * Prisma delegate keys AuditInterceptor is allowed to before-fetch against
 * (via `request.params.id`) — a closed union rather than a free string so
 * the interceptor's dynamic `this.prisma[model]` access stays type-safe
 * without an `any` cast. Deliberately does NOT include
 * "paymentGatewayConfig" — see the security note in payment-gateway-config.ts.
 */
export type AuditModelKey =
  | "scoreEntry"
  | "feeStructure"
  | "payment"
  | "discountRequest"
  | "staffAssignment"
  | "invitation";

export interface AuditOptions {
  entityType: string;
  model?: AuditModelKey;
}

export const AUDIT_KEY = "audit:entity";

/**
 * PRD §7 Auditability NFR / ARCHITECTURE §5: declares that a handler's
 * write is sensitive enough to log — the mechanism itself lives entirely
 * in AuditInterceptor (registered globally), so this is the only thing a
 * controller ever has to add.
 */
export const Audited = (entityType: string, model?: AuditModelKey) =>
  SetMetadata(AUDIT_KEY, { entityType, model } satisfies AuditOptions);
