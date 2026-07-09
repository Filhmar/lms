import { Global, Module } from "@nestjs/common";
import { ConfigService } from "./config";
import { HealthController } from "./health.controller";
import { HttpSmsDriver } from "./otp-delivery/http-sms.driver";
import { MockDriver } from "./otp-delivery/mock.driver";
import { OTP_DELIVERY_PORT, type OtpDeliveryPort } from "./otp-delivery/otp-delivery.port";
import { UsappDriver } from "./otp-delivery/usapp.driver";
import { PrismaService } from "./prisma.service";
import { RedisService } from "./redis.service";
import { LocalFsStorage } from "./storage/local-fs.driver";
import { OBJECT_STORAGE } from "./storage/object-storage.port";

/**
 * Cross-cutting infrastructure: Zod-validated config (fail-fast), the shared
 * pg.Pool + PrismaClient, Redis, the ObjectStorage + OtpDelivery ports, and
 * /health. Global so feature modules never re-wire infrastructure.
 */
@Global()
@Module({
  controllers: [HealthController],
  providers: [
    ConfigService,
    PrismaService,
    RedisService,
    { provide: OBJECT_STORAGE, useClass: LocalFsStorage },
    MockDriver,
    HttpSmsDriver,
    UsappDriver,
    {
      provide: OTP_DELIVERY_PORT,
      useFactory: (
        config: ConfigService,
        mock: MockDriver,
        http: HttpSmsDriver,
        usapp: UsappDriver,
      ): OtpDeliveryPort => {
        switch (config.config.OTP_DELIVERY_DRIVER) {
          case "usapp":
            return usapp;
          case "http":
            return http;
          default:
            return mock;
        }
      },
      inject: [ConfigService, MockDriver, HttpSmsDriver, UsappDriver],
    },
  ],
  exports: [ConfigService, PrismaService, RedisService, OBJECT_STORAGE, OTP_DELIVERY_PORT],
})
export class PlatformModule {}
