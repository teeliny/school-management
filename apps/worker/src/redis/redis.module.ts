import { Global, Inject, Module, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

// Mirrors apps/api/src/redis/redis.module.ts verbatim — same
// duplication-not-sharing precedent as parseCorsOrigins() and the
// BullModule.forRootAsync connection config. Only needed here for the
// /health Redis PING; BullMQ manages its own internal connection separately.
export const REDIS_CLIENT = Symbol("REDIS_CLIENT");

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (config: ConfigService) => new Redis(config.getOrThrow<string>("REDIS_URL")),
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onModuleDestroy() {
    await this.redis.quit();
  }
}
