import { Global, Inject, Logger, Module, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

// Mirrors apps/api/src/redis/redis.module.ts verbatim — same
// duplication-not-sharing precedent as parseCorsOrigins() and the
// BullModule.forRootAsync connection config. Only needed here for the
// /health Redis PING; BullMQ manages its own internal connection separately.
export const REDIS_CLIENT = Symbol("REDIS_CLIENT");
const logger = new Logger("RedisClient");

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (config: ConfigService) => {
        const client = new Redis(config.getOrThrow<string>("REDIS_URL"));
        client.on("error", (error) => logger.error(`Redis connection error: ${error.message}`, error.stack));
        return client;
      },
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
