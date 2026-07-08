import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  CredentialDetail,
  CredentialKind,
  CredentialListItem,
  CredentialStatus,
  VerifyResponse,
} from "@rl/schemas";
import type { AuthenticatedUser } from "../auth";
import { ScopeAccessService } from "../org-hierarchy";
import { ConfigService } from "../../platform/config";
import {
  CredentialsRepository,
  type AdminCredentialRow,
  type CredentialRow,
} from "./credentials.repository";
import { IssuerKeyService } from "./issuer-keys.service";
import { verifyVc } from "./vc";

/** Not-found and not-yours collapse — never confirm a foreign credential id. */
const CREDENTIAL_NOT_FOUND = "Credential not found";

/** Admin oversight entry: list item + holder identity + revocation detail. */
export interface AdminCredentialItem extends CredentialListItem {
  holderName: string;
  userId: string;
  issuedScopeId: string;
  revokedReason: string | null;
}

export interface AdminListResponse {
  items: AdminCredentialItem[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class CredentialsService {
  constructor(
    private readonly repo: CredentialsRepository,
    private readonly scopeAccess: ScopeAccessService,
    private readonly keys: IssuerKeyService,
    private readonly configService: ConfigService,
  ) {}

  /** GET /credentials — the caller's wallet (own view, unmasked). */
  async listMine(actor: AuthenticatedUser): Promise<CredentialListItem[]> {
    const rows = await this.repo.listByUser(actor.sub);
    return rows.map(toListItem);
  }

  /** GET /credentials/:id — own credentials only; includes the signed VC. */
  async getDetail(id: string, actor: AuthenticatedUser): Promise<CredentialDetail> {
    const row = await this.repo.findById(id);
    if (!row || row.user_id !== actor.sub) {
      throw new NotFoundException(CREDENTIAL_NOT_FOUND);
    }
    return {
      ...toListItem(row),
      holderName: String(row.metadata_snapshot.holderName ?? ""),
      verifyUrl: `${this.verifyBase}/c/${row.verify_code}`,
      vc: row.vc,
    };
  }

  /** GET /credentials/admin — oversight list over the caller's subtree. */
  async adminList(
    query: { scopeId?: string; page: number; pageSize: number },
    actor: AuthenticatedUser,
  ): Promise<AdminListResponse> {
    const scopeId = query.scopeId ?? actor.scopeId;
    await this.assertInSubtree(actor, scopeId);
    const { rows, total } = await this.repo.listForScopeSubtree(
      scopeId,
      query.page,
      query.pageSize,
    );
    return {
      items: rows.map(toAdminItem),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** POST /credentials/:id/revoke — admin, subtree-checked; audited. */
  async revoke(
    id: string,
    reason: string,
    actor: AuthenticatedUser,
  ): Promise<AdminCredentialItem> {
    await this.loadForAdmin(id, actor, "active");
    const row = await this.repo.revoke(id, reason, actor.sub);
    // Lost a race with a concurrent revoke — surface the same 409.
    if (!row) throw new ConflictException("Credential is already revoked");
    return toAdminItem({ ...row, holder_name: holderNameOf(row) });
  }

  /** POST /credentials/:id/restore — admin, subtree-checked; audited. */
  async restore(id: string, actor: AuthenticatedUser): Promise<AdminCredentialItem> {
    await this.loadForAdmin(id, actor, "revoked");
    const row = await this.repo.restore(id, actor.sub);
    if (!row) throw new ConflictException("Credential is not revoked");
    return toAdminItem({ ...row, holder_name: holderNameOf(row) });
  }

  /**
   * Public verify: read model only, signature re-checked at read time
   * against the versioned issuer public key. Unknown codes get the same
   * response shape (status not_found) — never a 404 that differs from a
   * malformed code.
   */
  async publicVerify(code: string): Promise<VerifyResponse> {
    const row = await this.repo.findVerifyRead(normalizeCode(code));
    if (!row) {
      return {
        status: "not_found",
        maskedName: null,
        title: null,
        issuerLine: null,
        issuedAt: null,
        controlNo: null,
        signatureValid: null,
      };
    }
    const publicKeyPem = await this.keys.getPublicKeyPem(row.key_version);
    const signatureValid = publicKeyPem !== null && verifyVc(row.vc, publicKeyPem);
    return {
      // Revoked keeps the masked details (design: show what was revoked).
      status: row.status === "revoked" ? "revoked" : "verified",
      maskedName: row.masked_name,
      title: row.title,
      issuerLine: row.issuer_line,
      issuedAt: row.issued_at.toISOString(),
      controlNo: row.control_no,
      signatureValid,
    };
  }

  private get verifyBase(): string {
    return this.configService.config.VERIFY_PUBLIC_BASE;
  }

  /** Load + subtree-authorize; expected-status mismatch is a 409. */
  private async loadForAdmin(
    id: string,
    actor: AuthenticatedUser,
    expectedStatus: string,
  ): Promise<CredentialRow> {
    const row = await this.repo.findById(id);
    if (row) {
      const allowed = await this.scopeAccess.canAccess(
        actor.scopeId,
        row.issued_scope_id,
      );
      // 404, not 403 — never confirm a credential outside the subtree exists.
      if (!allowed) throw new NotFoundException(CREDENTIAL_NOT_FOUND);
    }
    if (!row) throw new NotFoundException(CREDENTIAL_NOT_FOUND);
    if (row.status !== expectedStatus) {
      throw new ConflictException(
        expectedStatus === "active"
          ? "Credential is already revoked"
          : "Credential is not revoked",
      );
    }
    return row;
  }

  private async assertInSubtree(
    actor: AuthenticatedUser,
    scopeId: string,
  ): Promise<void> {
    if (!(await this.scopeAccess.canAccess(actor.scopeId, scopeId))) {
      throw new NotFoundException(
        "Scope not accessible from your position in the hierarchy",
      );
    }
  }
}

function toListItem(row: CredentialRow): CredentialListItem {
  return {
    id: row.id,
    kind: row.kind as CredentialKind,
    title: row.title,
    monogram: row.monogram,
    status: row.status as CredentialStatus,
    controlNo: row.control_no,
    verifyCode: row.verify_code,
    issuedAt: row.issued_at.toISOString(),
    issuerLine: row.issuer_line,
  };
}

function toAdminItem(row: AdminCredentialRow): AdminCredentialItem {
  return {
    ...toListItem(row),
    holderName: row.holder_name,
    userId: row.user_id,
    issuedScopeId: row.issued_scope_id,
    revokedReason: row.revoked_reason,
  };
}

function holderNameOf(row: CredentialRow): string {
  return String(row.metadata_snapshot.holderName ?? "");
}

/** Codes are case-insensitive; tolerate a missing dash from hand-typing. */
function normalizeCode(raw: string): string {
  const cleaned = raw.trim().toUpperCase();
  if (/^[A-Z0-9]{8}$/.test(cleaned)) {
    return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
  }
  return cleaned;
}
