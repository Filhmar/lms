/**
 * QR-scan landing alias: credentials print their public URL as
 * `{VERIFY_PUBLIC_BASE}/c/{code}` (the standalone verifier's route shape),
 * which the in-app portal serves at /verify/c/{code} — same result page.
 */
export { default } from "../../[code]/page";
