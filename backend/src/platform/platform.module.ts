import { Global, Module } from "@nestjs/common";
import { ConfigService } from "./config";
import { HealthController } from "./health.controller";
import { PrismaService } from "./prisma.service";
import { RedisService } from "./redis.service";
import { LocalFsStorage } from "./storage/local-fs.driver";
import { OBJECT_STORAGE } from "./storage/object-storage.port";

/**
 * Cross-cutting infrastructure: Zod-validated config (fail-fast), the shared
 * pg.Pool + PrismaClient, Redis, the ObjectStorage port, and /health.
 * Global so feature modules never re-wire infrastructure.
 */
@Global()
@Module({
  controllers: [HealthController],
  providers: [
    ConfigService,
    PrismaService,
    RedisService,
    { provide: OBJECT_STORAGE, useClass: LocalFsStorage },
  ],
  exports: [ConfigService, PrismaService, RedisService, OBJECT_STORAGE],
})
export class PlatformModule {}
