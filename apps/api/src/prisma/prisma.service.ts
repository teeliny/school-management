import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/**
 * A single, standard Prisma client for this deployment's one database
 * (ARCHITECTURE.md §6) — instantiated once and reused for the process
 * lifetime via normal NestJS DI. No per-tenant resolution, no client cache.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
