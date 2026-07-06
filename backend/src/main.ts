import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { loadConfig } from "./platform/config";
import { ZodValidationPipe } from "./platform/zod-validation.pipe";

async function bootstrap(): Promise<void> {
  const config = loadConfig(); // fail-fast before Nest even boots
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.use(helmet());
  app.setGlobalPrefix("api/v1", {
    // JWKS lives at the RFC well-known path, outside the API prefix.
    exclude: [".well-known/jwks.json"],
  });
  app.useGlobalPipes(new ZodValidationPipe());
  app.enableShutdownHooks(); // graceful: pool/redis/queue/worker close via lifecycle hooks

  await app.listen(config.PORT);
  new Logger("Bootstrap").log(
    `Resilient-Learn backend listening on :${config.PORT} (prefix /api/v1)`,
  );
}

void bootstrap();
