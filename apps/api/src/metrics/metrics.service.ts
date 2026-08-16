import { Injectable } from "@nestjs/common";
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";
import { PrismaService } from "../prisma/prisma.service";

/**
 * ARCHITECTURE.md §13: request latency/error rate per route and the
 * Payment.status = PENDING_APPROVAL count ("a stuck queue here is a real
 * operational signal, not just a UX nicety"). BullMQ queue depth/age lives
 * on the worker's own /metrics instead (apps/worker/src/metrics), since
 * that's where the queues are actually consumed.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly httpRequestDuration: Histogram<"method" | "route" | "status_code">;
  readonly httpRequestsTotal: Counter<"method" | "route" | "status_code">;

  constructor(private readonly prisma: PrismaService) {
    collectDefaultMetrics({ register: this.registry });

    this.httpRequestDuration = new Histogram({
      name: "http_request_duration_seconds",
      help: "HTTP request duration in seconds",
      labelNames: ["method", "route", "status_code"],
      registers: [this.registry],
    });
    this.httpRequestsTotal = new Counter({
      name: "http_requests_total",
      help: "Total HTTP requests",
      labelNames: ["method", "route", "status_code"],
      registers: [this.registry],
    });

    const prismaService = this.prisma;
    new Gauge({
      name: "payment_pending_approval_count",
      help: "Count of Payment rows with status = PENDING_APPROVAL, awaiting Super-Admin review",
      registers: [this.registry],
      async collect(this: Gauge) {
        this.set(await prismaService.payment.count({ where: { status: "PENDING_APPROVAL" } }));
      },
    });
  }

  metrics(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
