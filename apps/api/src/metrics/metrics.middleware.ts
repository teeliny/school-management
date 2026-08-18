import { Injectable, NestMiddleware } from "@nestjs/common";
import { MetricsService } from "./metrics.service";

// Minimal shape, not express.Request/Response — same "define only what's
// used" precedent as fees/payment-gateway-webhook.ts's WebhookRequest,
// since express itself isn't a direct dependency of this app.
interface MetricsRequest {
  method: string;
  path: string;
  route?: { path: string };
}
interface MetricsResponse {
  statusCode: number;
  on(event: "finish", listener: () => void): unknown;
}

/**
 * Middleware, not an interceptor: res.statusCode isn't reliably final at
 * the point an interceptor's tap() runs (Nest sets it after the
 * interceptor chain resolves), but it always is by the raw HTTP "finish"
 * event — the standard prom-client + Express pattern.
 */
@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: MetricsRequest, res: MetricsResponse, next: () => void) {
    const start = process.hrtime.bigint();
    res.on("finish", () => {
      const labels = {
        method: req.method,
        route: req.route?.path ?? req.path,
        status_code: String(res.statusCode),
      };
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
      this.metrics.httpRequestDuration.observe(labels, durationSeconds);
      this.metrics.httpRequestsTotal.inc(labels);
    });
    next();
  }
}
