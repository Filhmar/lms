/**
 * Envelope encryption for exam answers — pure Web Crypto, no DOM, no React.
 * (This module graduates to packages/crypto when the React Native port
 * starts; keep it free of browser-only APIs beyond WebCrypto/atob/btoa.)
 *
 * Per docs/TECHSTACK.md §3: direct RSA-OAEP caps at 190 bytes for a 2048-bit
 * key, so answers are NEVER RSA-encrypted directly. Each answer gets a fresh
 * AES-256-GCM data key; the data key is wrapped with the exam's versioned
 * RSA-OAEP-256 public key (SPKI PEM from the exam package).
 *
 * Contract with the grading worker (backend/src/modules/cbt/exam-crypto.ts,
 * read-only reference):
 *   · plaintext is exactly  JSON.stringify({ value })  — the chosen option id
 *     for mcq/tf or the typed text for ident;
 *   · the 16-byte GCM auth tag stays APPENDED to the ciphertext
 *     (subtle.encrypt semantics — the server splits it off);
 *   · all envelope fields are base64.
 */

import type { EncryptedEnvelope } from "@rl/schemas";

function pemToDer(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----(BEGIN|END) PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function toBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** Memoized SPKI imports — one RSA key import per exam key, not per answer. */
const keyCache = new Map<string, Promise<CryptoKey>>();

export function importExamKey(publicKeyPem: string): Promise<CryptoKey> {
  let cached = keyCache.get(publicKeyPem);
  if (!cached) {
    cached = crypto.subtle.importKey(
      "spki",
      pemToDer(publicKeyPem) as BufferSource,
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["encrypt"],
    );
    keyCache.set(publicKeyPem, cached);
  }
  return cached;
}

/**
 * Encrypt one answer value at write time → EncryptedEnvelope. Only the
 * grading side (server private key) can read it back; a student inspecting
 * IndexedDB sees ciphertext.
 */
export async function encryptAnswer(
  publicKeyPem: string,
  keyVersion: number,
  value: string,
): Promise<EncryptedEnvelope> {
  const rsaKey = await importExamKey(publicKeyPem);
  const aesKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    new TextEncoder().encode(JSON.stringify({ value })),
  );
  const rawAes = await crypto.subtle.exportKey("raw", aesKey);
  const wrappedKey = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    rsaKey,
    rawAes,
  );
  return {
    alg: "RSA-OAEP-256+A256GCM",
    keyVersion,
    wrappedKey: toBase64(wrappedKey),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
  };
}
