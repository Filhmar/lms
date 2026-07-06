import { Controller, Get, Header } from "@nestjs/common";
import { JwksService } from "./jwks.service";

/**
 * Public JWKS endpoint — deliberately OUTSIDE the /api/v1 prefix (excluded in
 * main.ts) so satellite services (worker, verify) discover the verification
 * key at the RFC-standard well-known path.
 */
@Controller(".well-known")
export class JwksController {
  constructor(private readonly jwksService: JwksService) {}

  @Get("jwks.json")
  @Header("Cache-Control", "public, max-age=300")
  getJwks() {
    return this.jwksService.getJwks();
  }
}
