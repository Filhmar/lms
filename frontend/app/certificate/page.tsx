"use client";

/**
 * Certificate render — key screen p4c (blue on-screen version, 660px,
 * print/screenshot friendly) + deep dive d9c (B/W school-printer variant
 * and its print spec card: A4/Letter, 12mm margins, pure-black ink, QR
 * ≥ 22mm with the human-readable code beside it), REAL:
 * `?id=` picks a credential; without it the caller's first certificate is
 * rendered (GET /credentials → GET /credentials/:id, cached on-device).
 * The QR is a real scannable code of the public verify URL.
 *
 * The blue version is for sharing as an image; printing always uses the
 * mono variant automatically (@media print swaps the DOM tree).
 * Formal register only — this is the one surface that stays formal.
 */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Button } from "@rl/ui";
import type { CredentialDetail } from "@rl/schemas";
import { QrCode } from "@/components/qr";
import { RequireAuth, useSession } from "@/lib/session";
import { useCredentialDetail, useWallet } from "@/lib/wallet";

const MONO = "ui-monospace, Menlo, monospace";

const PRINT_CSS = `
.cert-print { display: none; }
@media print {
  @page { margin: 12mm; }
  body * { visibility: hidden; }
  .cert-print, .cert-print * { visibility: visible; }
  .cert-print {
    display: block;
    position: absolute;
    left: 0;
    top: 0;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  /* Print spec: QR at least 22mm with its quiet zone. */
  .cert-print .cert-qr { width: 24mm !important; height: 24mm !important; }
}
`;

export default function CertificatePage() {
  return (
    <RequireAuth>
      <Suspense fallback={null}>
        <CertificateScreen />
      </Suspense>
    </RequireAuth>
  );
}

/* ------------------------------- data model ------------------------------- */

interface CertModel {
  holder: string;
  title: string;
  /** Reversed issuer chain — "Region IV-A · Division of Cavite · San Isidro NHS". */
  scopeLine: string;
  /** "Given this 28th day of March 2026". */
  dateLine: string;
  /** Issuing school (first part of the issuer line) — signature block. */
  school: string;
  controlNo: string;
  verifyCode: string;
  verifyUrl: string;
  revoked: boolean;
}

function ordinal(n: number): string {
  const rem10 = n % 10;
  const rem100 = n % 100;
  if (rem10 === 1 && rem100 !== 11) return `${n}st`;
  if (rem10 === 2 && rem100 !== 12) return `${n}nd`;
  if (rem10 === 3 && rem100 !== 13) return `${n}rd`;
  return `${n}th`;
}

function toModel(detail: CredentialDetail): CertModel {
  const issued = new Date(detail.issuedAt);
  const month = issued.toLocaleDateString("en-US", { month: "long" });
  const parts = detail.issuerLine.split(", ").filter(Boolean);
  return {
    holder: detail.holderName,
    title: detail.title,
    scopeLine: [...parts].reverse().join(" · "),
    dateLine: `Given this ${ordinal(issued.getDate())} day of ${month} ${issued.getFullYear()}`,
    school: parts[0] ?? detail.issuerLine,
    controlNo: detail.controlNo,
    verifyCode: detail.verifyCode,
    verifyUrl: detail.verifyUrl,
    revoked: detail.status === "revoked",
  };
}

function CertificateScreen() {
  const { user } = useSession();
  const searchParams = useSearchParams();
  const queryId = searchParams.get("id");

  // Without ?id=, resolve the caller's first certificate (active preferred)
  // from the wallet — live when reachable, on-device cache otherwise.
  const wallet = useWallet(queryId ? undefined : user?.id);
  const [resolvedId, setResolvedId] = useState<string | null>(queryId);
  useEffect(() => {
    if (queryId) {
      setResolvedId(queryId);
      return;
    }
    if (!wallet.ready) return;
    const certs = wallet.items.filter((c) => c.kind === "certificate");
    const first = certs.find((c) => c.status === "active") ?? certs[0];
    setResolvedId(first?.id ?? null);
  }, [queryId, wallet.ready, wallet.live, wallet.items]);

  const detail = useCredentialDetail(user?.id, resolvedId);

  // Empty state only once we know for sure (live list said "none" / 404).
  const certainlyNone =
    (!queryId && wallet.live && resolvedId === null) || (detail.ready && detail.notFound);
  if (certainlyNone && !detail.detail) return <EmptyState />;
  if (!detail.ready || !detail.detail) return null;
  const cert = toModel(detail.detail);

  return (
    <main style={{ minHeight: "100dvh", background: "var(--color-canvas)" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          maxWidth: 724,
          margin: "0 auto",
          padding: "16px 16px 8px",
        }}
      >
        <Link
          href="/wallet"
          aria-label="Back to badges"
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            background: "var(--color-card)",
            border: "1px solid var(--color-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--color-ink)",
            flexShrink: 0,
          }}
        >
          <ChevronLeft />
        </Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>{cert.title}</h1>
          <div style={{ fontSize: 11.5, color: "var(--color-ink-subtle)" }}>
            Print always uses the black-and-white version automatically.
          </div>
        </div>
        <Button size="small" onClick={() => window.print()}>
          Print / Save PDF
        </Button>
      </header>

      {cert.revoked ? (
        <div style={{ maxWidth: 724, margin: "0 auto", padding: "0 16px" }}>
          <div
            role="status"
            style={{
              background: "var(--color-attention-bg)",
              border: "1.5px solid var(--color-danger-border)",
              borderRadius: 12,
              padding: "10px 13px",
              fontSize: 12,
              fontWeight: 600,
              lineHeight: 1.5,
              color: "var(--color-attention-fg)",
            }}
          >
            This certificate is no longer valid — its public page shows REVOKED.
            It stays here for your records.
          </div>
        </div>
      ) : null}

      <div style={{ overflowX: "auto" }}>
        <div style={{ padding: "12px 16px 28px", width: "fit-content", margin: "0 auto" }}>
          <ScreenCertificate cert={cert} />
        </div>
      </div>

      <PrintCertificate cert={cert} />
      <style>{PRINT_CSS}</style>
    </main>
  );
}

function EmptyState() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "var(--color-canvas)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        className="rl-card"
        style={{ borderRadius: 16, padding: 22, textAlign: "center", maxWidth: 380 }}
      >
        <div style={{ fontSize: 15, fontWeight: 800 }}>No certificate here yet</div>
        <div
          style={{
            fontSize: 12,
            color: "var(--color-ink-subtle)",
            lineHeight: 1.55,
            marginTop: 6,
          }}
        >
          Completing a whole course earns one — it will appear in your wallet,
          ready to print or share.
        </div>
        <Link
          href="/wallet"
          style={{
            display: "inline-block",
            marginTop: 14,
            color: "var(--color-primary)",
            fontSize: 12.5,
            fontWeight: 800,
            textDecoration: "none",
          }}
        >
          Back to my badges
        </Link>
      </div>
    </main>
  );
}

function ChevronLeft() {
  return (
    <svg
      width={19}
      height={19}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14.5 5.5L8 12l6.5 6.5" />
    </svg>
  );
}

/** On-screen (blue) certificate — p4c layout, values from the credential. */
function ScreenCertificate({ cert }: { cert: CertModel }) {
  return (
    <div
      className="cert-screen"
      style={{
        width: 660,
        background: "#ffffff",
        color: "#17233F",
        padding: 26,
        borderRadius: 10,
        boxShadow: "0 8px 28px rgba(20,30,55,0.10)",
      }}
    >
      <div style={{ border: "2px solid #1E4AC2", borderRadius: 6, padding: 6 }}>
        <div
          style={{
            border: "1px solid #C9D4E8",
            borderRadius: 3,
            padding: "28px 32px",
            background: "#FDFEFF",
          }}
        >
          {/* Letterhead */}
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              aria-hidden="true"
              style={{
                width: 54,
                height: 54,
                borderRadius: "50%",
                border: "2px solid #1E4AC2",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  border: "1.5px dashed #93A3C4",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 6.5,
                  fontFamily: MONO,
                  color: "#5B6B8C",
                  textAlign: "center",
                  lineHeight: 1.4,
                }}
              >
                DepEd
                <br />
                seal
              </div>
            </div>
            <div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: "0.14em",
                  color: "#5B6B8C",
                }}
              >
                REPUBLIC OF THE PHILIPPINES · DEPARTMENT OF EDUCATION
              </div>
              <div style={{ fontSize: 10.5, color: "#5B6B8C", marginTop: 3 }}>
                {cert.scopeLine}
              </div>
            </div>
          </div>

          {/* Body */}
          <div style={{ textAlign: "center", marginTop: 24 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.18em",
                color: "#1E4AC2",
              }}
            >
              CERTIFICATE OF COMPLETION
            </div>
            <div style={{ fontSize: 11.5, color: "#5B6B8C", marginTop: 12 }}>
              This certifies that
            </div>
            <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: "0.01em", marginTop: 6 }}>
              {cert.holder}
            </div>
            <div style={{ width: 280, height: 1.5, background: "#C9D4E8", margin: "8px auto 0" }} />
            <div
              style={{
                fontSize: 12.5,
                color: "#3D4A66",
                lineHeight: 1.6,
                maxWidth: 420,
                margin: "12px auto 0",
              }}
            >
              has satisfactorily earned <b>{cert.title}</b> under the K–12 Basic Education
              Program.
            </div>
            <div style={{ fontSize: 11, color: "#5B6B8C", marginTop: 10 }}>{cert.dateLine}</div>
          </div>

          {/* Footer */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              marginTop: 26,
            }}
          >
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 170, height: 1.5, background: "#17233F" }} />
              <div style={{ fontSize: 11, fontWeight: 700, marginTop: 5 }}>{cert.school}</div>
              <div style={{ fontSize: 9.5, color: "#5B6B8C" }}>Issuing school</div>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
              <div style={{ textAlign: "right", fontSize: 9, color: "#5B6B8C", lineHeight: 1.5 }}>
                Verify this certificate:
                <br />
                <b style={{ color: "#1E4AC2", overflowWrap: "anywhere" }}>{cert.verifyUrl}</b>
                <br />
                Control No. {cert.controlNo}
              </div>
              <div
                style={{
                  width: 74,
                  height: 74,
                  border: "4px solid #ffffff",
                  outline: "1.5px solid #C9D4E8",
                  flexShrink: 0,
                }}
              >
                <QrCode value={cert.verifyUrl} size="100%" color="#17233F" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** B/W school-printer certificate — d9c, monochrome ink palette only. */
function PrintCertificate({ cert }: { cert: CertModel }) {
  return (
    <div
      className="cert-print"
      style={{ width: 660, background: "#ffffff", color: "#17181A", padding: 24 }}
    >
      <div style={{ border: "2px solid #17181A", borderRadius: 4, padding: 5 }}>
        <div style={{ border: "1px solid #9A9C9F", borderRadius: 2, padding: "24px 30px" }}>
          {/* Letterhead */}
          <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
            <div
              aria-hidden="true"
              style={{
                width: 50,
                height: 50,
                borderRadius: "50%",
                border: "2px solid #17181A",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  width: 37,
                  height: 37,
                  borderRadius: "50%",
                  border: "1.5px dashed #6B6F76",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 6,
                  fontFamily: MONO,
                  color: "#6B6F76",
                  textAlign: "center",
                  lineHeight: 1.4,
                }}
              >
                DepEd
                <br />
                seal
              </div>
            </div>
            <div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: "0.14em",
                  color: "#3A3C40",
                }}
              >
                REPUBLIC OF THE PHILIPPINES · DEPARTMENT OF EDUCATION
              </div>
              <div style={{ fontSize: 10, color: "#6B6F76", marginTop: 3 }}>{cert.scopeLine}</div>
            </div>
          </div>

          {/* Body */}
          <div style={{ textAlign: "center", marginTop: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.18em" }}>
              CERTIFICATE OF COMPLETION
            </div>
            <div style={{ fontSize: 11, color: "#6B6F76", marginTop: 10 }}>This certifies that</div>
            <div style={{ fontSize: 28, fontWeight: 800, marginTop: 5 }}>{cert.holder}</div>
            <div style={{ width: 270, height: 1.5, background: "#9A9C9F", margin: "7px auto 0" }} />
            <div
              style={{
                fontSize: 12,
                color: "#3A3C40",
                lineHeight: 1.6,
                maxWidth: 410,
                margin: "10px auto 0",
              }}
            >
              has satisfactorily earned <b>{cert.title}</b> under the K–12 Basic Education
              Program.
            </div>
            <div style={{ fontSize: 10.5, color: "#6B6F76", marginTop: 9 }}>{cert.dateLine}</div>
          </div>

          {/* Footer */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              marginTop: 22,
            }}
          >
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 160, height: 1.5, background: "#17181A" }} />
              <div style={{ fontSize: 10.5, fontWeight: 700, marginTop: 4 }}>{cert.school}</div>
              <div style={{ fontSize: 9, color: "#6B6F76" }}>Issuing school</div>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
              <div
                style={{ textAlign: "right", fontSize: 8.5, color: "#3A3C40", lineHeight: 1.55 }}
              >
                Verify: <b style={{ overflowWrap: "anywhere" }}>{cert.verifyUrl}</b>
                <br />
                Control No. {cert.controlNo}
                <br />
                Code: <b style={{ fontFamily: MONO }}>{cert.verifyCode}</b>
              </div>
              <div
                className="cert-qr"
                style={{
                  width: 70,
                  height: 70,
                  border: "5px solid #ffffff",
                  outline: "1.5px solid #9A9C9F",
                  flexShrink: 0,
                }}
              >
                <QrCode value={cert.verifyUrl} size="100%" color="#17181A" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
