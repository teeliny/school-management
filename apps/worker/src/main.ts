import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { AppModule } from "./app.module";
import { parseCorsOrigins } from "./common/cors";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
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
