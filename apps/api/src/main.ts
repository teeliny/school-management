// Sentry's own Nest integration requirement: must be imported before any
// other module (see instrument.ts's own comment for why).
import "./instrument";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { ValidationPipe } from "@nestjs/common";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { parseCorsOrigins } from "./common/cors";
import { RedisIoAdapter } from "./notifications/redis-io.adapter";

async function bootstrap() {
  // rawBody: true (Nest 9.4+) makes req.rawBody (a Buffer) available on
  // every request alongside the normal parsed req.body — needed by the
  // payment-gateway webhook handlers, which must verify Monnify/Paystack's
  // HMAC signature against the exact raw bytes, not a re-serialized JSON
  // object (a re-serialized body can have different whitespace/key
  // ordering, which silently breaks signature verification). Doesn't affect
  // any other route.
  const app = await NestFactory.create(AppModule, { rawBody: true, bufferLogs: true });
  // Routes Nest's own bootstrap/internal logs (and every existing
  // `new Logger(SomeClass.name)` call site) through pino, transparently.
  app.useLogger(app.get(Logger));
  const config = app.get(ConfigService);

  app.enableCors({
    origin: parseCorsOrigins(config),
    credentials: true,
  });

  app.setGlobalPrefix("api/v1", { exclude: ["health", "metrics"] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // ARCHITECTURE §8: Socket.IO on the Redis adapter, so a notification
  // emitted from any API process instance reaches a client connected to any
  // other instance.
  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`api listening on :${port}`);
}

bootstrap();
