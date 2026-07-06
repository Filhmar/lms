import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { loadConfig } from "../../platform/config";
import { AuthController } from "./auth.controller";
import { AuthRepository } from "./auth.repository";
import { AuthService } from "./auth.service";
import { JwksController } from "./jwks.controller";
import { JwksService } from "./jwks.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { RolesGuard } from "./roles";

// Config loads synchronously and fail-fast at import time, so a static
// JwtModule.register is safe (keys are already validated to exist).
const config = loadConfig();

@Module({
  imports: [
    JwtModule.register({
      privateKey: config.jwtPrivateKeyPem,
      publicKey: config.jwtPublicKeyPem,
      signOptions: { algorithm: "RS256" },
    }),
  ],
  controllers: [AuthController, JwksController],
  providers: [AuthService, AuthRepository, JwksService, JwtAuthGuard, RolesGuard],
  exports: [JwtAuthGuard, RolesGuard, JwtModule],
})
export class AuthModule {}
