import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../platform/prisma.service";

/**
 * KeyProvider port — how the grading worker obtains the per-exam private key
 * for a given key version. Designed so a KMS (Azure Key Vault / AWS KMS /
 * Vault) can slot in behind the same interface: a KMS driver would perform
 * the RSA unwrap INSIDE the KMS and return/wield the key without it ever
 * leaving the vault (TECHSTACK §5.5).
 */
export interface KeyProvider {
  /** PKCS#8 PEM for (examId, keyVersion). Throws if unknown. */
  getPrivateKeyPem(examId: string, keyVersion: number): Promise<string>;
}

export const KEY_PROVIDER = Symbol("rl.cbt.keyProvider");

/**
 * ⚠️⚠️ DEV-GRADE KEY CUSTODY — READ BEFORE SHIPPING ⚠️⚠️
 *
 * The 'db' driver reads the per-exam RSA private key from cbt.exams where it
 * sits in PLAINTEXT. That is acceptable for development ONLY. Before any
 * real exam runs on this system, replace this driver with a KMS-backed
 * KeyProvider (encrypted-at-rest, non-exportable keys, audit-logged decrypt
 * operations) — the port above exists precisely so that swap is one DI
 * binding in cbt.module.ts. Never expose private_key_pem through any API
 * response, log line, or error message.
 */
@Injectable()
export class DbKeyProvider implements KeyProvider {
  constructor(private readonly prisma: PrismaService) {}

  async getPrivateKeyPem(examId: string, keyVersion: number): Promise<string> {
    const result = await this.prisma.pool.query<{ private_key_pem: string }>(
      `SELECT private_key_pem
       FROM cbt.exams
       WHERE id = $1::uuid AND key_version = $2`,
      [examId, keyVersion],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error(`No private key for exam ${examId} key_version ${keyVersion}`);
    }
    return row.private_key_pem;
  }
}
