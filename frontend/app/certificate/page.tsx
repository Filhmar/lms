"use client";

/**
 * Certificate render — key screen p4c (blue on-screen version, 660px,
 * print/screenshot friendly) + deep dive d9c (B/W school-printer variant
 * and its print spec card: A4/Letter, 12mm margins, pure-black ink, QR
 * ≥ 22mm with the human-readable code beside it).
 *
 * The blue version is for sharing as an image; printing always uses the
 * mono variant automatically (@media print swaps the DOM tree).
 * Formal register only — this is the one surface that stays formal.
 */

import Link from "next/link";
import { Button } from "@rl/ui";
import { credential } from "@/lib/fixtures";
import { FakeQr } from "../wallet/fake-qr";

const MONO = "ui-monospace, Menlo, monospace";
const verifyUrl = `${credential.verifyHost}/c/${credential.verifyCode}`;

/* Demo data registry (deep-dives Appendix B): the certificate itself carries
   the holder's full name — masking exists only on the public portal. */
const CERT = {
  holder: "Ana Marie D. Reyes",
  scopeLine:
    "Region IV-A · Division of Cavite · Dasmariñas District · San Isidro National High School",
  dateLine: "Given this 28th day of March 2026 · Dasmariñas City, Cavite",
  principal: "Maria C. Villanueva",
  principalRole: "School Principal",
} as const;

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

/** On-screen (blue) certificate — p4c, all values verbatim. */
function ScreenCertificate() {
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
                {CERT.scopeLine}
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
              {CERT.holder}
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
              has satisfactorily completed <b>Grade 7</b> under the K–12 Basic Education Program
              during School Year 2025–2026.
            </div>
            <div style={{ fontSize: 11, color: "#5B6B8C", marginTop: 10 }}>{CERT.dateLine}</div>
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
              <div style={{ fontSize: 11, fontWeight: 700, marginTop: 5 }}>{CERT.principal}</div>
              <div style={{ fontSize: 9.5, color: "#5B6B8C" }}>{CERT.principalRole}</div>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
              <div style={{ textAlign: "right", fontSize: 9, color: "#5B6B8C", lineHeight: 1.5 }}>
                Verify this certificate:
                <br />
                <b style={{ color: "#1E4AC2" }}>{verifyUrl}</b>
                <br />
                Control No. {credential.controlNo}
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
                <FakeQr code={verifyUrl} size="100%" color="#17233F" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** B/W school-printer certificate — d9c, monochrome ink palette only. */
function PrintCertificate() {
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
              <div style={{ fontSize: 10, color: "#6B6F76", marginTop: 3 }}>{CERT.scopeLine}</div>
            </div>
          </div>

          {/* Body */}
          <div style={{ textAlign: "center", marginTop: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.18em" }}>
              CERTIFICATE OF COMPLETION
            </div>
            <div style={{ fontSize: 11, color: "#6B6F76", marginTop: 10 }}>This certifies that</div>
            <div style={{ fontSize: 28, fontWeight: 800, marginTop: 5 }}>{CERT.holder}</div>
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
              has satisfactorily completed <b>Grade 7</b> under the K–12 Basic Education Program
              during School Year 2025–2026.
            </div>
            <div style={{ fontSize: 10.5, color: "#6B6F76", marginTop: 9 }}>{CERT.dateLine}</div>
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
              <div style={{ fontSize: 10.5, fontWeight: 700, marginTop: 4 }}>{CERT.principal}</div>
              <div style={{ fontSize: 9, color: "#6B6F76" }}>{CERT.principalRole}</div>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
              <div
                style={{ textAlign: "right", fontSize: 8.5, color: "#3A3C40", lineHeight: 1.55 }}
              >
                Verify: <b>{verifyUrl}</b>
                <br />
                Control No. {credential.controlNo}
                <br />
                Code: <b style={{ fontFamily: MONO }}>{credential.verifyCode}</b>
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
                <FakeQr code={verifyUrl} size="100%" color="#17181A" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CertificatePage() {
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
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Certificate of Completion</h1>
          <div style={{ fontSize: 11.5, color: "var(--color-ink-subtle)" }}>
            Print always uses the black-and-white version automatically.
          </div>
        </div>
        <Button size="small" onClick={() => window.print()}>
          Print / Save PDF
        </Button>
      </header>

      <div style={{ overflowX: "auto" }}>
        <div style={{ padding: "12px 16px 28px", width: "fit-content", margin: "0 auto" }}>
          <ScreenCertificate />
        </div>
      </div>

      <PrintCertificate />
      <style>{PRINT_CSS}</style>
    </main>
  );
}
