import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { MetricsController } from "./metrics.controller";
import { MetricsMiddleware } from "./metrics.middleware";
import { MetricsService } from "./metrics.service";

@Module({
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Applied to every route (including /metrics itself) so the endpoint's
    // own scrape requests show up too, same as any other route.
    consumer.apply(MetricsMiddleware).forRoutes("*");
  }
}
