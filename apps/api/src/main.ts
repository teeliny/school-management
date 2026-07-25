import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api/v1", { exclude: ["health"] });

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`api listening on :${port}`);
}

bootstrap();
