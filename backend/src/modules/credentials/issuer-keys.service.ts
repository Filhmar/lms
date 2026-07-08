import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { PrismaService } from "../../platform/prisma.service";
import { ensureIssuerKeyV1, type IssuerSigningKey } from "./issue-credential";

/**
 * Issuer key custody port-in-miniature (mirrors cbt's KeyProvider). Boot
 * ensures Ed25519 key version 1 exists (race-safe across replicas via
 * ON CONFLICT (version) DO NOTHING); signing always uses the highest
 * version; verification resolves any historical version — key_version is
 * recorded in every assertion so rotation never invalidates history.
 *
 * ⚠️ DEV-GRADE KEY CUSTODY ⚠️ — private halves live in creds.issuer_keys in
 * plaintext (same caveat as cbt.exams): swap for a KMS-backed signer before
 * production. Never expose private_key_pem through any response or log.
 */
@Injectable()
export class IssuerKeyService implements OnApplicationBootstrap {
  private readonly logger = new Logger(IssuerKeyService.name);
  private signingKey?: IssuerSigningKey;
  private readonly publicKeys = new Map<number, string>();

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    const client = await this.prisma.pool.connect();
    try {
      await ensureIssuerKeyV1(client);
      this.logger.log("issuer key v1 present (Ed25519)");
    } finally {
      client.release();
    }
  }

  /** Highest-version key, cached — the signing key for new credentials. */
  async getSigningKey(): Promise<IssuerSigningKey> {
    if (this.signingKey) return this.signingKey;
    const result = await this.prisma.pool.query<{
      version: number;
      public_key_pem: string;
      private_key_pem: string;
    }>(
      `SELECT version, public_key_pem, private_key_pem
       FROM creds.issuer_keys ORDER BY version DESC LIMIT 1`,
    );
    const row = result.rows[0];
    if (!row) throw new Error("no issuer key — boot ensure did not run?");
    this.signingKey = {
      version: row.version,
      publicKeyPem: row.public_key_pem,
      privateKeyPem: row.private_key_pem,
    };
    return this.signingKey;
  }

  /** Public half for a specific version (verification path), cached. */
  async getPublicKeyPem(version: number): Promise<string | null> {
    const cached = this.publicKeys.get(version);
    if (cached) return cached;
    const result = await this.prisma.pool.query<{ public_key_pem: string }>(
      `SELECT public_key_pem FROM creds.issuer_keys WHERE version = $1`,
      [version],
    );
    const pem = result.rows[0]?.public_key_pem ?? null;
    if (pem) this.publicKeys.set(version, pem);
    return pem;
  }
}
