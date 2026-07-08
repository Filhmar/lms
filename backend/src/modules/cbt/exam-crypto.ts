import {
  constants,
  createDecipheriv,
  generateKeyPairSync,
  privateDecrypt,
} from "node:crypto";
import type { EncryptedEnvelope } from "@rl/schemas";

/**
 * Per-exam envelope crypto (TECHSTACK §3/§5.5).
 *
 * Client side (PWA / verify script): generate a random AES-256-GCM data key,
 * encrypt the plaintext answer, wrap the AES key with the exam's RSA-OAEP-256
 * public key → EncryptedEnvelope { alg, keyVersion, wrappedKey, iv,
 * ciphertext } (all fields base64). Direct RSA caps at 190 bytes — never
 * encrypt payloads with RSA directly.
 *
 * PLAINTEXT SHAPE (the contract between the PWA and the grading worker):
 *   { "value": string }
 * where value is the chosen option id for mcq/tf (e.g. "opt-2", "true") or
 * the typed answer for ident (e.g. "Barometer"). The same shape is used by
 * scripts/verify-cbt.ts.
 *
 * Ciphertext convention: WebCrypto AES-GCM output — the 16-byte auth tag is
 * APPENDED to the ciphertext (subtle.encrypt semantics); the server splits it
 * off before createDecipheriv.
 */

export const ANSWER_ENVELOPE_ALG = "RSA-OAEP-256+A256GCM";
const GCM_TAG_BYTES = 16;

export interface ExamKeyPair {
  /** SPKI PEM — shipped to the PWA inside the exam package. */
  publicKeyPem: string;
  /** PKCS#8 PEM — grading-side only; NEVER serialized into any response. */
  privateKeyPem: string;
}

/** RSA-2048 keypair for one exam key version (seed-time / exam creation). */
export function generateExamKeyPair(): ExamKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKeyPem: publicKey, privateKeyPem: privateKey };
}

/**
 * Grading-side decrypt: unwrap the AES data key with RSA-OAEP-SHA256, then
 * AES-256-GCM decrypt (tag appended to ciphertext). Returns the UTF-8
 * plaintext (the `{ "value": ... }` JSON string). Throws on any tamper/
 * key mismatch — callers treat that answer as ungradeable (score 0 + warn).
 */
export function decryptEnvelope(
  envelope: EncryptedEnvelope,
  privateKeyPem: string,
): string {
  const dataKey = privateDecrypt(
    {
      key: privateKeyPem,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    Buffer.from(envelope.wrappedKey, "base64"),
  );
  const iv = Buffer.from(envelope.iv, "base64");
  const blob = Buffer.from(envelope.ciphertext, "base64");
  if (blob.length <= GCM_TAG_BYTES) throw new Error("ciphertext too short");
  const tag = blob.subarray(blob.length - GCM_TAG_BYTES);
  const body = blob.subarray(0, blob.length - GCM_TAG_BYTES);

  const decipher = createDecipheriv("aes-256-gcm", dataKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}
