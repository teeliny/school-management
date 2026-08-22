import { Global, Inject, Logger, Module, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

export const REDIS_CLIENT = Symbol("REDIS_CLIENT");
const logger = new Logger("RedisClient");

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (config: ConfigService) => {
        const client = new Redis(config.getOrThrow<string>("REDIS_URL"));
        // Without this, ioredis falls back to a bare console.error on any
        // connection error (its own internal "Unhandled error event"
        // guard) instead of going through the app's real logger.
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

  // The ioredis client is a plain value provider with no lifecycle hooks of
  // its own, so without this its open TCP connection keeps the process
  // alive after `app.close()` — e.g. `pnpm setup:school` would hang forever.
  async onModuleDestroy() {
    await this.redis.quit();
  }
}
