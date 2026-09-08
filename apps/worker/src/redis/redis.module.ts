import { Global, Inject, Logger, Module, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

// Mirrors apps/api/src/redis/redis.module.ts verbatim. This client is also
// handed to BullModule.forRootAsync (see app.module.ts) so queues/workers
// share it instead of each opening their own connection.
export const REDIS_CLIENT = Symbol("REDIS_CLIENT");
const logger = new Logger("RedisClient");

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (config: ConfigService) => {
        // maxRetriesPerRequest: null is required so this instance can be
        // shared with BullMQ (see app.module.ts) — BullMQ's blocking Worker
        // connections throw at startup otherwise.
        const client = new Redis(config.getOrThrow<string>("REDIS_URL"), { maxRetriesPerRequest: null });
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
