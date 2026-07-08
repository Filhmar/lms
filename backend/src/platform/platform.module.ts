import { Global, Module } from "@nestjs/common";
import { ConfigService } from "./config";
import { HealthController } from "./health.controller";
import { PrismaService } from "./prisma.service";
import { RedisService } from "./redis.service";
import { HttpSmsDriver } from "./sms/http-sms.driver";
import { MockSmsDriver } from "./sms/mock-sms.driver";
import { SMS_PORT } from "./sms/sms.port";
import { LocalFsStorage } from "./storage/local-fs.driver";
import { OBJECT_STORAGE } from "./storage/object-storage.port";

/**
 * Cross-cutting infrastructure: Zod-validated config (fail-fast), the shared
 * pg.Pool + PrismaClient, Redis, the ObjectStorage + Sms ports, and /health.
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
    MockSmsDriver,
    HttpSmsDriver,
    {
      provide: SMS_PORT,
      useFactory: (config: ConfigService, mock: MockSmsDriver, http: HttpSmsDriver) =>
        config.config.SMS_DRIVER === "http" ? http : mock,
      inject: [ConfigService, MockSmsDriver, HttpSmsDriver],
    },
  ],
  exports: [ConfigService, PrismaService, RedisService, OBJECT_STORAGE, SMS_PORT],
})
export class PlatformModule {}
