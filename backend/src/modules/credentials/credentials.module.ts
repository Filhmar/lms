import { Module } from "@nestjs/common";
import { AuthModule } from "../auth";
import { OrgHierarchyModule } from "../org-hierarchy";
import { CredentialsController } from "./credentials.controller";
import { CredentialsRepository } from "./credentials.repository";
import { CredentialsService } from "./credentials.service";
import { CredentialIssuer } from "./issuer.service";
import { IssuerKeyService } from "./issuer-keys.service";
import { VerifyController } from "./verify.controller";

/**
 * Phase IV micro-credentials: Ed25519-signed Open Badges 3.0 assertions
 * (never PDFs), automatic issuance, revocation with audit, and the public
 * verify endpoint backed by the creds.verify_read read model. Deliberately
 * imports NOTHING from cbt/courses — those modules call the exported
 * CredentialIssuer seam instead (no cycles).
 */
@Module({
  imports: [AuthModule, OrgHierarchyModule],
  controllers: [CredentialsController, VerifyController],
  providers: [
    CredentialsService,
    CredentialsRepository,
    CredentialIssuer,
    IssuerKeyService,
  ],
  // CredentialIssuer is the issuance seam for cbt (graded attempt → badge)
  // and courses (course completed → certificate).
  exports: [CredentialIssuer],
})
export class CredentialsModule {}
