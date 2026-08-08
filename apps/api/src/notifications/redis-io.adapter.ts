import { INestApplicationContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { ServerOptions } from "socket.io";
import Redis from "ioredis";
import { REDIS_CLIENT } from "../redis/redis.module";
import { parseCorsOrigins } from "../common/cors";

/**
 * ARCHITECTURE §8, FR8.2: lets a notification emitted from any API process
 * instance reach a client connected to any other instance — relevant once
 * this school's deployment runs more than one API process behind a load
 * balancer. Duplicates the shared REDIS_CLIENT into a dedicated pub/sub pair
 * rather than reusing it directly, since a client in subscribe mode can't
 * issue other commands.
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(private readonly app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const sharedClient = this.app.get<Redis>(REDIS_CLIENT);
    const pubClient = sharedClient.duplicate();
    const subClient = sharedClient.duplicate();
    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    const config = this.app.get(ConfigService);
    const server = super.createIOServer(port, {
      ...options,
      cors: { origin: parseCorsOrigins(config), credentials: true },
    });
    server.adapter(this.adapterConstructor);
    return server;
  }
}
