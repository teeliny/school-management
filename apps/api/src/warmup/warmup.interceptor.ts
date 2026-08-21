import { CallHandler, ExecutionContext, Inject, Injectable, Logger, NestInterceptor } from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import Redis from "ioredis";
import { REDIS_CLIENT } from "../redis/redis.module";

export const LAST_ACTIVE_KEY = "api:last-active";
export const LAST_ACTIVE_TTL_SECONDS = 15 * 60;

/**
 * Registered globally (see warmup.module.ts) so every successful request —
 * not just `@Audited(...)` ones — refreshes this key. apps/web's Next.js
 * server reads it directly from Redis to tell whether a cold-start probe is
 * needed before forwarding a real request, without having to ask the API
 * itself (which may be the very thing that's asleep).
 */
@Injectable()
export class WarmupInterceptor implements NestInterceptor {
  private readonly logger = new Logger(WarmupInterceptor.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();

    return next.handle().pipe(
      tap(() => {
        // Unconditional reset on every success (not read-then-conditionally-refresh)
        // — produces the same sliding-window behavior with no extra round trip.
        this.redis
          .set(LAST_ACTIVE_KEY, Date.now().toString(), "EX", LAST_ACTIVE_TTL_SECONDS)
          .catch((error: unknown) => this.logger.warn(`Failed to refresh ${LAST_ACTIVE_KEY}: ${String(error)}`));
      }),
    );
  }
}
