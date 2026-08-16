import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Prisma } from "@prisma/client";
import { Observable, from, of } from "rxjs";
import { switchMap, tap } from "rxjs/operators";
import { PrismaService } from "../prisma/prisma.service";
import { AUDIT_KEY, AuditOptions } from "./audited.decorator";

const KNOWN_VERBS = ["approve", "reject", "revoke", "resend", "sync", "accept", "transfer", "swap", "reset-password"];

/**
 * Escape hatch for a route the generic `:id`-param before-fetch can't
 * handle — a composite-natural-key upsert like ScoreEntry.enter(), where
 * "was this a create or a correction" isn't derivable from the HTTP method
 * alone. The handler itself (which already knows, having looked the row up
 * before writing) stashes the answer on the request; the interceptor
 * prefers it over its own derivation when present. See
 * assessments/score-entry.ts's enter() for the one current use.
 */
export interface AuditRequestOverrides {
  auditAction?: string;
  auditBefore?: unknown;
}

/**
 * ARCHITECTURE §5: the single place "who changed what" actually gets
 * written — registered once as a global APP_INTERCEPTOR (see
 * audit.module.ts), so no service ever calls into this directly. A
 * controller method opts in with `@Audited(entityType, model?)`; everything
 * else (actor, action, before/after snapshot, persistence) happens here.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();

    const options = this.reflector.get<AuditOptions | undefined>(AUDIT_KEY, context.getHandler());
    if (!options) return next.handle();

    const request = context.switchToHttp().getRequest();
    const method: string = request.method;
    const id: string | undefined = request.params?.id;
    // null for the unauthenticated gateway-webhook writes (HMAC-verified,
    // no JWT) and the pre-account invitation-accept flow — a real actor
    // concept doesn't exist for either.
    const actorUserId: string | null = request.user?.id ?? null;
    const routePath: string = request.route?.path ?? request.url;

    const before$ =
      options.model && id && method !== "POST"
        ? from(
            (
              this.prisma[options.model] as unknown as {
                findUnique: (args: { where: { id: string } }) => Promise<unknown>;
              }
            )
              .findUnique({ where: { id } })
              .catch(() => null),
          )
        : of(null);

    return before$.pipe(
      switchMap((before) =>
        next.handle().pipe(
          tap((response) => {
            const overrides = request as AuditRequestOverrides;
            const action = overrides.auditAction ?? this.deriveAction(method, routePath);
            const resolvedBefore = "auditBefore" in overrides ? overrides.auditBefore : before;
            this.prisma.auditLog
              .create({
                data: {
                  actorUserId,
                  action,
                  entityType: options.entityType,
                  entityId: id ?? (response as { id?: string } | undefined)?.id ?? null,
                  before: (resolvedBefore ?? undefined) as Prisma.InputJsonValue | undefined,
                  after: (response ?? undefined) as Prisma.InputJsonValue | undefined,
                  route: `${method} ${routePath}`,
                },
              })
              // An audit-log failure must never fail the real mutation it
              // describes — the write already succeeded and its response
              // is already on its way to the client by the time this runs.
              .catch((error: unknown) => {
                this.logger.warn(`Failed to write audit log for ${method} ${routePath}: ${String(error)}`);
              });
          }),
        ),
      ),
    );
  }

  private deriveAction(method: string, routePath: string): string {
    const lastSegment = routePath.split("/").filter(Boolean).pop();
    if (lastSegment && KNOWN_VERBS.includes(lastSegment)) return lastSegment.toUpperCase();
    if (method === "POST") return "CREATE";
    if (method === "DELETE") return "DELETE";
    return "UPDATE";
  }
}
