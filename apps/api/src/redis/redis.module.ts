import { Global, Inject, Module, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

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

  // The ioredis client is a plain value provider with no lifecycle hooks of
  // its own, so without this its open TCP connection keeps the process
  // alive after `app.close()` — e.g. `pnpm setup:school` would hang forever.
  async onModuleDestroy() {
    await this.redis.quit();
  }
}
