import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "../../platform/config";
import { PrismaService } from "../../platform/prisma.service";
import {
  issueBadgeForGradedAttempt,
  maybeIssueCertificateForCourse,
} from "./issue-credential";
import { IssuerKeyService } from "./issuer-keys.service";

/**
 * Automatic credential issuance — the public seam other modules call:
 *  - cbt's grading worker after an attempt lands in `graded` → badge;
 *  - courses' progress sync when completed pages reach the course total
 *    → certificate.
 * Both are idempotent (cheap existence check + partial unique index with
 * ON CONFLICT DO NOTHING), and each issuance writes credentials +
 * verify_read + audit in ONE transaction.
 */
@Injectable()
export class CredentialIssuer {
  private readonly logger = new Logger(CredentialIssuer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly keys: IssuerKeyService,
    private readonly configService: ConfigService,
  ) {}

  /** Badge for a graded attempt. Safe to call on re-graded replays. */
  async issueForGradedAttempt(attemptId: string): Promise<void> {
    const issued = await this.inTransaction((client, key, base) =>
      issueBadgeForGradedAttempt(client, attemptId, key, base),
    );
    if (issued) {
      this.logger.log(
        `issued ${issued.kind} "${issued.title}" (${issued.controlNo}) for attempt ${attemptId}`,
      );
    }
  }

  /** Certificate when the user's completed count reaches the course total. */
  async maybeIssueCourseCertificate(userId: string, courseId: string): Promise<void> {
    const issued = await this.inTransaction((client, key, base) =>
      maybeIssueCertificateForCourse(client, userId, courseId, key, base),
    );
    if (issued) {
      this.logger.log(
        `issued ${issued.kind} "${issued.title}" (${issued.controlNo}) for course ${courseId}`,
      );
    }
  }

  private async inTransaction<T>(
    work: (
      client: import("pg").PoolClient,
      key: Awaited<ReturnType<IssuerKeyService["getSigningKey"]>>,
      verifyBase: string,
    ) => Promise<T>,
  ): Promise<T> {
    const key = await this.keys.getSigningKey();
    const verifyBase = this.configService.config.VERIFY_PUBLIC_BASE;
    const client = await this.prisma.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client, key, verifyBase);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}
