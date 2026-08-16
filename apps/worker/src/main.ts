// Sentry's own Nest integration requirement: must be imported before any
// other module (see instrument.ts's own comment for why).
import "./instrument";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { parseCorsOrigins } from "./common/cors";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  const config = app.get(ConfigService);

  app.enableCors({
    origin: parseCorsOrigins(config),
    credentials: true,
  });

  const port = process.env.WORKER_PORT ?? 3002;
  await app.listen(port);
  console.log(`worker health server listening on :${port}`);
}

bootstrap();
