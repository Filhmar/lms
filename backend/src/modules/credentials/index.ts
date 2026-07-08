/**
 * PUBLIC CONTRACT of the credentials module (Phase IV micro-credentials).
 * Other modules may import from "../credentials" ONLY (module-public-index rule).
 *
 * vc/issue-credential helpers are exported for scripts/seed.ts, the live
 * verification scripts, and the standalone ./verify deployable's build-time
 * reference — pure node:crypto + pg, no Nest wiring (exam-crypto pattern).
 */
export { CredentialsModule } from "./credentials.module";
export { CredentialIssuer } from "./issuer.service";
export {
  jcsCanonicalize,
  verifyVc,
  generateIssuerKeyPair,
  assertionHashHex,
} from "./vc";
export {
  ensureIssuerKeyV1,
  issueCredential,
  issueBadgeForGradedAttempt,
  maybeIssueCertificateForCourse,
} from "./issue-credential";
