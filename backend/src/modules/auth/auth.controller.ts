import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import {
  ActivationConfirmSchema,
  ActivationRequestSchema,
  LoginRequestSchema,
  LogoutRequestSchema,
  RefreshRequestSchema,
} from "@rl/schemas";
import type { Request } from "express";
import { createZodDto } from "../../platform/zod-validation.pipe";
import { AuthService } from "./auth.service";

class LoginDto extends createZodDto(LoginRequestSchema) {}
class RefreshDto extends createZodDto(RefreshRequestSchema) {}
class LogoutDto extends createZodDto(LogoutRequestSchema) {}
class ActivationRequestDto extends createZodDto(ActivationRequestSchema) {}
class ActivationConfirmDto extends createZodDto(ActivationConfirmSchema) {}

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** POST /api/v1/auth/login → { accessToken (15m RS256), refreshToken (7d), user } */
  @Post("login")
  @HttpCode(200)
  login(@Body() body: LoginDto) {
    return this.authService.login(body.email, body.password);
  }

  /** POST /api/v1/auth/refresh — rotation with reuse detection. */
  @Post("refresh")
  @HttpCode(200)
  refresh(@Body() body: RefreshDto) {
    return this.authService.refresh(body.refreshToken);
  }

  /** POST /api/v1/auth/logout — revokes the presented refresh token. */
  @Post("logout")
  @HttpCode(204)
  async logout(@Body() body: LogoutDto): Promise<void> {
    await this.authService.logout(body.refreshToken);
  }

  /**
   * POST /api/v1/auth/activation/request (PUBLIC) — SMS a 6-digit code to a
   * pending account's phone. Rate-limited per user and per IP (req.ip honors
   * trust proxy, set in main.ts).
   */
  @Post("activation/request")
  @HttpCode(200)
  requestActivation(@Body() body: ActivationRequestDto, @Req() req: Request) {
    return this.authService.requestActivation(body.email, req.ip ?? "unknown");
  }

  /** POST /api/v1/auth/activation/confirm (PUBLIC) — verify code, set password, auto-login. */
  @Post("activation/confirm")
  @HttpCode(200)
  confirmActivation(@Body() body: ActivationConfirmDto) {
    return this.authService.confirmActivation(body);
  }
}
