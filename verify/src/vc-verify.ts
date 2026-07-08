import { createHash, verify as edVerify } from "node:crypto";

/**
 * Self-contained eddsa-jcs-2022 proof verification (W3C VC-DI-EdDSA, JCS
 * variant): RFC 8785 canonicalization + base58btc decode + Ed25519 verify.
 *
 * This deliberately MIRRORS backend/src/modules/credentials/vc.ts — the
 * verify deployable imports NOTHING from backend/ (isolation is the whole
 * point of the portal; only @rl/schemas types are shared). Keep the two in
 * sync; the shared `packages/crypto` workspace is the documented extraction
 * once a third consumer appears. UPGRADE NOTE: 1EdTech-conformance hardening
 * is eddsa-rdfc-2022 (RDF canonicalization via @digitalbazaar libs) — only
 * the canonicalization step changes.
 */

/** RFC 8785 JSON Canonicalization Scheme (sorted keys = UTF-16 code-unit
 *  order; JSON.stringify escaping/number forms match the RFC). */
export function jcsCanonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error("JCS: non-finite numbers are not representable");
      }
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new Error(`JCS: cannot canonicalize a ${typeof value}`);
  }
  if (Array.isArray(value)) {
    return `[${value
      .map((item) => jcsCanonicalize(item === undefined ? null : item))
      .join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const propValue = record[key];
    if (propValue === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${jcsCanonicalize(propValue)}`);
  }
  return `{${parts.join(",")}}`;
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_INDEX = new Map([...BASE58_ALPHABET].map((c, i) => [c, i] as const));

function base58btcDecode(text: string): Uint8Array {
  let zeros = 0;
  while (zeros < text.length && text[zeros] === "1") zeros += 1;
  const bytes: number[] = [];
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

/** Signature input: sha256(JCS(proof options)) || sha256(JCS(document)). */
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

/** Ed25519-verify a DataIntegrityProof (eddsa-jcs-2022). Never throws. */
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
      proofOptions.type !== "DataIntegrityProof" ||
      proofOptions.cryptosuite !== "eddsa-jcs-2022" ||
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
