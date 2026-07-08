import {
  createHash,
  generateKeyPairSync,
  sign as edSign,
  verify as edVerify,
} from "node:crypto";

/**
 * Open Badges 3.0 verifiable credentials with Ed25519 Data Integrity proofs
 * (TECHSTACK §3 #4 / §5.5: NOT RSA-PSS — RSA-PSS fails 1EdTech conformance).
 *
 * Cryptosuite: **eddsa-jcs-2022** (W3C VC-DI-EdDSA, JCS variant) —
 * canonicalization is RFC 8785 JSON Canonicalization Scheme implemented
 * below, dependency-free. UPGRADE NOTE: the 1EdTech-conformance hardening
 * step is switching to `eddsa-rdfc-2022` (RDF Dataset Canonicalization via
 * the @digitalbazaar/* libraries); the proof envelope, key material, and
 * every table column stay the same — only the canonicalization swaps.
 *
 * Everything here is pure node:crypto + plain JSON (no Nest wiring), so the
 * seed script, the verification scripts, and the future ./worker extraction
 * import it directly — same pattern as cbt/exam-crypto.ts.
 */

/* ------------------------- RFC 8785 (JCS) ------------------------- */

/**
 * JSON Canonicalization Scheme (RFC 8785):
 *  - object keys sorted by UTF-16 code units (JS default string ordering),
 *  - no insignificant whitespace,
 *  - strings serialized with JSON.stringify (its escaping — shortest form,
 *    \u00XX for control characters — matches RFC 8785 §3.2.2.2),
 *  - numbers serialized per ECMAScript Number::toString (JSON.stringify
 *    matches for all finite numbers, including -0 → "0" and the exponent
 *    forms); NaN/Infinity are an error per the RFC.
 * VC payloads here are strings/objects/arrays (numbers appear only as
 * integers like key versions), so the number edge cases stay theoretical —
 * but the implementation is complete regardless.
 */
export function jcsCanonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error("JCS: non-finite numbers are not representable");
      }
      return JSON.stringify(value); // ES Number::toString serialization
    case "string":
      return JSON.stringify(value); // RFC 8785-compliant escaping
    case "object":
      break;
    default:
      // undefined / function / symbol / bigint have no JCS form.
      throw new Error(`JCS: cannot canonicalize a ${typeof value}`);
  }
  if (Array.isArray(value)) {
    return `[${value
      .map((item) => jcsCanonicalize(item === undefined ? null : item))
      .join(",")}]`;
  }
  // Sort keys by UTF-16 code units (default JS string comparison);
  // undefined-valued properties are skipped, like JSON.stringify.
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const propValue = record[key];
    if (propValue === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${jcsCanonicalize(propValue)}`);
  }
  return `{${parts.join(",")}}`;
}

/* --------------------------- base58btc --------------------------- */

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_INDEX = new Map([...BASE58_ALPHABET].map((c, i) => [c, i] as const));

/** Multibase base58btc body (callers add/strip the 'z' prefix). */
export function base58btcEncode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  const digits: number[] = []; // little-endian base58 digits
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i]!;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j]! * 256;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  return (
    "1".repeat(zeros) +
    digits
      .reverse()
      .map((d) => BASE58_ALPHABET[d]!)
      .join("")
  );
}

export function base58btcDecode(text: string): Uint8Array {
  let zeros = 0;
  while (zeros < text.length && text[zeros] === "1") zeros += 1;
  const bytes: number[] = []; // little-endian byte accumulator
  for (let i = zeros; i < text.length; i++) {
    const digit = BASE58_INDEX.get(text[i]!);
    if (digit === undefined) throw new Error("base58btc: invalid character");
    let carry = digit;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j]! * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  return Uint8Array.from([...Array(zeros).fill(0), ...bytes.reverse()]);
}

/* ----------------------- keys & VC building ----------------------- */

export interface IssuerKeyPair {
  /** SPKI PEM — public; shipped to verifiers. */
  publicKeyPem: string;
  /** PKCS#8 PEM — issuance-side only (dev-grade DB custody; see schema). */
  privateKeyPem: string;
}

/** Ed25519 keypair for one issuer key version (boot/seed-time). */
export function generateIssuerKeyPair(): IssuerKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKeyPem: publicKey, privateKeyPem: privateKey };
}

export const VC_CONTEXTS = [
  "https://www.w3.org/ns/credentials/v2",
  "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json",
] as const;

export interface UnsignedVcInput {
  /** Public credential URL — `${verifyBase}/c/${verifyCode}`. */
  credentialUrl: string;
  /** Issuer id — the verify portal base URL. */
  issuerId: string;
  /** e.g. "San Isidro NHS, Division of Cavite, Region IV-A". */
  issuerName: string;
  /** Issue instant (ISO 8601). */
  validFrom: string;
  holderName: string;
  achievementName: string;
  achievementDescription: string;
  criteriaNarrative: string;
}

/** JSON-LD-shaped OpenBadgeCredential (OB 3.0), ready for signing. */
export function buildUnsignedVc(input: UnsignedVcInput): Record<string, unknown> {
  return {
    "@context": [...VC_CONTEXTS],
    id: input.credentialUrl,
    type: ["VerifiableCredential", "OpenBadgeCredential"],
    issuer: {
      id: input.issuerId,
      type: "Profile",
      name: input.issuerName,
    },
    validFrom: input.validFrom,
    credentialSubject: {
      type: "AchievementSubject",
      name: input.holderName,
      achievement: {
        type: "Achievement",
        name: input.achievementName,
        description: input.achievementDescription,
        criteria: { narrative: input.criteriaNarrative },
      },
    },
  };
}

/** sha256 hex of the JCS-canonicalized UNSIGNED VC — the assertion hash. */
export function assertionHashHex(unsignedVc: Record<string, unknown>): string {
  return createHash("sha256").update(jcsCanonicalize(unsignedVc), "utf8").digest("hex");
}

/* ------------------- eddsa-jcs-2022 sign / verify ------------------- */

const PROOF_TYPE = "DataIntegrityProof";
export const CRYPTOSUITE = "eddsa-jcs-2022";

/**
 * Signature input per W3C VC-DI-EdDSA (jcs variant):
 *   sha256(JCS(proof options)) || sha256(JCS(unsigned document))
 * where the proof options are the proof without `proofValue`, carrying the
 * document's `@context` (the spec's compatibility guard).
 */
function hashData(
  proofOptions: Record<string, unknown>,
  unsignedDoc: Record<string, unknown>,
): Buffer {
  const proofHash = createHash("sha256")
    .update(jcsCanonicalize(proofOptions), "utf8")
    .digest();
  const docHash = createHash("sha256")
    .update(jcsCanonicalize(unsignedDoc), "utf8")
    .digest();
  return Buffer.concat([proofHash, docHash]);
}

/**
 * Sign an unsigned VC → the same object plus a DataIntegrityProof
 * (cryptosuite eddsa-jcs-2022, proofValue multibase base58btc 'z…').
 * verificationMethod is `${verifyBase}/keys/${keyVersion}` — the verify
 * portal serves the SPKI public key there conceptually; verifiers here
 * resolve it from creds.issuer_keys by version.
 */
export function signVc(
  unsignedVc: Record<string, unknown>,
  privateKeyPem: string,
  verificationMethod: string,
  createdAt: string,
): Record<string, unknown> {
  const proofOptions: Record<string, unknown> = {
    "@context": unsignedVc["@context"],
    type: PROOF_TYPE,
    cryptosuite: CRYPTOSUITE,
    created: createdAt,
    verificationMethod,
    proofPurpose: "assertionMethod",
  };
  const signature = edSign(null, hashData(proofOptions, unsignedVc), privateKeyPem);
  return {
    ...unsignedVc,
    proof: { ...proofOptions, proofValue: `z${base58btcEncode(signature)}` },
  };
}

/**
 * Recompute the eddsa-jcs-2022 hash data and Ed25519-verify the proof.
 * Returns false (never throws) on any malformed/tampered/mismatched input —
 * used by GET /verify/:code (backend + standalone service) and the live
 * verification script.
 */
export function verifyVc(vc: unknown, publicKeyPem: string): boolean {
  try {
    if (typeof vc !== "object" || vc === null || Array.isArray(vc)) return false;
    const { proof, ...unsignedDoc } = vc as Record<string, unknown> & {
      proof?: unknown;
    };
    if (typeof proof !== "object" || proof === null || Array.isArray(proof)) {
      return false;
    }
    const { proofValue, ...proofOptions } = proof as Record<string, unknown> & {
      proofValue?: unknown;
    };
    if (
      proofOptions.type !== PROOF_TYPE ||
      proofOptions.cryptosuite !== CRYPTOSUITE ||
      typeof proofValue !== "string" ||
      !proofValue.startsWith("z")
    ) {
      return false;
    }
    const signature = base58btcDecode(proofValue.slice(1));
    return edVerify(
      null,
      hashData(proofOptions, unsignedDoc),
      publicKeyPem,
      signature,
    );
  } catch {
    return false;
  }
}
