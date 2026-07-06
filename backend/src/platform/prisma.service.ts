import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "../generated/prisma/client";
import { ConfigService } from "./config";

/**
 * One shared pg.Pool serves BOTH the Prisma driver adapter and raw SQL
 * (closure-table statements, COPY bulk import) — per TECHSTACK §5.3.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  /** Shared pool: use for raw SQL. Always fully qualify table names (auth.*, org.*, prov.*). */
  readonly pool: Pool;
  readonly client: PrismaClient;

  constructor(configService: ConfigService) {
    this.pool = new Pool({
      connectionString: configService.config.DATABASE_URL,
      max: 10,
    });
    const adapter = new PrismaPg(this.pool);
    this.client = new PrismaClient({ adapter });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect().catch((e) => this.logger.warn(String(e)));
    await this.pool.end().catch((e) => this.logger.warn(String(e)));
  }
}
