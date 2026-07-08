/**
 * PUBLIC CONTRACT of the cbt module (Phase II CBT + LWW sync).
 * Other modules may import from "../cbt" ONLY (module-public-index rule).
 *
 * exam-crypto helpers are exported for scripts/seed.ts and the future
 * ./worker extraction — they are pure node:crypto, no Nest wiring.
 */
export { CbtModule } from "./cbt.module";
export { generateExamKeyPair, ANSWER_ENVELOPE_ALG } from "./exam-crypto";
export type { KeyProvider } from "./key-provider";
