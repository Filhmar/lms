import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";
import { ConfigService } from "./config";

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  /** General-purpose client (cache, scope-version keys, health ping). */
  readonly client: Redis;

  constructor(private readonly configService: ConfigService) {
    this.client = new Redis(configService.config.REDIS_URL, {
      lazyConnect: false,
      maxRetriesPerRequest: 2,
    });
    this.client.on("error", (err) => this.logger.warn(`redis: ${err.message}`));
  }

  /**
   * BullMQ requires its own connections with maxRetriesPerRequest: null —
   * callers own the returned connection's lifecycle.
   */
  createBullConnection(): Redis {
    return new Redis(this.configService.config.REDIS_URL, {
      maxRetriesPerRequest: null,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }
}
