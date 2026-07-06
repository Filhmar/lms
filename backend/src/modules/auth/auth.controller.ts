import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import {
  LoginRequestSchema,
  LogoutRequestSchema,
  RefreshRequestSchema,
} from "@rl/schemas";
import { createZodDto } from "../../platform/zod-validation.pipe";
import { AuthService } from "./auth.service";

class LoginDto extends createZodDto(LoginRequestSchema) {}
class RefreshDto extends createZodDto(RefreshRequestSchema) {}
class LogoutDto extends createZodDto(LogoutRequestSchema) {}

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
}
