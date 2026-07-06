import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { RedisService } from "./redis.service";

@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** GET /api/v1/health — real db + redis pings, no cached state. */
  @Get()
  async health() {
    const [db, redis] = await Promise.all([
      this.prisma.pool
        .query("SELECT 1")
        .then(() => "up" as const)
        .catch(() => "down" as const),
      this.redis.client
        .ping()
        .then(() => "up" as const)
        .catch(() => "down" as const),
    ]);

    const body = {
      status: db === "up" && redis === "up" ? "ok" : "degraded",
      db,
      redis,
      timestamp: new Date().toISOString(),
    };
    if (body.status !== "ok") {
      throw new ServiceUnavailableException(body);
    }
    return body;
  }
}
