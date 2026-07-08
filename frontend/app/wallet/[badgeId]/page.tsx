"use client";

/**
 * Badge detail — key screen p4b + deep dive d9b, REAL:
 * GET /credentials/:id (cached on-device after first view) — medallion,
 * holder, issuer line, control no., issue date, a real scannable QR of the
 * public verify URL, copy-link share, and the Open Badges 3.0 JSON download
 * (the signed VC, named <controlNo>.json).
 * `pending-<examId>` routes render the gated claim card — dashed medallion,
 * "Claim waiting to send", dimmed QR, sharing disabled — until the badge
 * arrives from the grading path, when the card flips official with the
 * quiet d9b toast.
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type CSSProperties, type ReactNode } from "react";
import { Button, Chip, Toast } from "@rl/ui";
import type { CredentialDetail } from "@rl/schemas";
import { AppShell } from "@/components/app-chrome";
import { QrCode } from "@/components/qr";
import { RequireAuth, useSession } from "@/lib/session";
import { useExamEngine } from "@/lib/exam/use-engine";
import {
  PENDING_PREFIX,
  deriveMonogram,
  fmtIssuedDate,
  useCredentialDetail,
  useWallet,
} from "@/lib/wallet";

export default function BadgeDetailPage() {
  return (
    <RequireAuth>
      <BadgeDetailScreen />
    </RequireAuth>
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

function BackHeader() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
      <h1 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Badge</h1>
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <div className="page-body" style={{ paddingTop: 16, gap: 12 }}>
        <BackHeader />
        {children}
      </div>
    </AppShell>
  );
}

const qrPanelStyle: CSSProperties = {
  marginTop: 16,
  padding: 13,
  border: "1.5px solid var(--color-border)",
  borderRadius: 12,
  display: "flex",
  alignItems: "center",
  gap: 14,
  textAlign: "left",
};

function NotHereCard() {
  return (
    <div className="rl-card" style={{ borderRadius: 16, padding: 20, textAlign: "center" }}>
      <div style={{ fontSize: 15, fontWeight: 800 }}>This badge isn&rsquo;t on this phone</div>
      <div
        style={{
          fontSize: 12,
          color: "var(--color-ink-subtle)",
          lineHeight: 1.55,
          marginTop: 5,
        }}
      >
        Open your wallet to see the badges saved here.
      </div>
    </div>
  );
}

function BadgeDetailScreen() {
  const params = useParams<{ badgeId: string }>();
  const badgeId = params.badgeId ?? "";
  const { user } = useSession();
  const eng = useExamEngine();

  const isPendingRoute = badgeId.startsWith(PENDING_PREFIX);
  const examId = isPendingRoute ? badgeId.slice(PENDING_PREFIX.length) : null;

  // While a claim is pending, watch the wallet — the moment the graded badge
  // arrives, this same route flips to the official card (d9b).
  const wallet = useWallet(isPendingRoute ? user?.id : undefined);
  const pendingTitle = examId
    ? (eng.packages[examId]?.title ?? eng.exams.find((e) => e.id === examId)?.title ?? null)
    : null;
  const confirmedId =
    isPendingRoute && pendingTitle
      ? (wallet.items.find(
          (c) => c.kind === "badge" && c.title === pendingTitle && c.status === "active",
        )?.id ?? null)
      : null;

  const detail = useCredentialDetail(
    user?.id,
    isPendingRoute ? confirmedId : badgeId,
  );

  if (isPendingRoute) {
    if (!eng.ready) return <Shell>{null}</Shell>;
    if (confirmedId) {
      return detail.detail ? (
        <RealDetail detail={detail.detail} justConfirmed />
      ) : (
        <Shell>{null}</Shell>
      );
    }
    if (!pendingTitle) {
      return (
        <Shell>
          <NotHereCard />
        </Shell>
      );
    }
    return <PendingDetail title={pendingTitle} holderName={user?.fullName ?? ""} />;
  }

  if (!detail.ready) return <Shell>{null}</Shell>;
  if (!detail.detail) {
    return (
      <Shell>
        <NotHereCard />
      </Shell>
    );
  }
  if (detail.detail.status === "revoked") {
    return <RevokedDetail detail={detail.detail} />;
  }
  return <RealDetail detail={detail.detail} />;
}

/* ------------------------------ pending card ------------------------------ */

function PendingDetail({ title, holderName }: { title: string; holderName: string }) {
  return (
    <Shell>
      <div
        style={{
          background: "var(--color-card)",
          border: "1.5px solid var(--color-border)",
          borderRadius: 16,
          padding: 20,
          textAlign: "center",
        }}
      >
        <div
          className="rl-medallion rl-medallion--pending"
          style={{ width: 84, height: 84, fontSize: 28, borderWidth: 3 }}
        >
          {deriveMonogram(title)}
        </div>
        <div style={{ fontSize: 19, fontWeight: 800, marginTop: 12 }}>{title}</div>
        <div
          style={{
            fontSize: 12.5,
            color: "var(--color-ink-subtle)",
            lineHeight: 1.5,
            marginTop: 4,
          }}
        >
          Earned by <b style={{ color: "var(--color-ink)" }}>{holderName}</b>
        </div>
        <div style={{ marginTop: 10 }}>
          <Chip tone="on-device" size="compact" icon={<PhoneCheckMini />}>
            Claim waiting to send
          </Chip>
        </div>

        <div
          style={{
            fontSize: 12.5,
            color: "var(--color-ink-subtle)",
            lineHeight: 1.55,
            marginTop: 10,
          }}
        >
          Saved on this phone. It becomes official — and scannable by anyone — after your
          school confirms it.
        </div>

        <div style={qrPanelStyle}>
          {/* Dimmed stand-in — a claim has no verify code until it's official. */}
          <div style={{ opacity: 0.35, flexShrink: 0 }}>
            <QrCode value="resilient-learn:pending" size={84} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--color-ink-faint)" }}>
              Scan to verify
            </div>
            <div
              style={{
                fontSize: 10.5,
                color: "var(--color-ink-subtle)",
                lineHeight: 1.5,
                marginTop: 2,
              }}
            >
              Once your school confirms it, the QR works for anyone.
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 9 }}>
        <Button style={{ flex: 1, fontSize: 13.5, fontWeight: 800 }} disabled>
          Copy link
        </Button>
        <Button
          variant="quiet"
          disabled
          style={{ flex: 1, fontSize: 13.5, fontWeight: 800 }}
        >
          Badge file
        </Button>
      </div>

      <div
        style={{
          fontSize: 11,
          color: "var(--color-ink-subtle)",
          textAlign: "center",
          padding: "0 4px",
        }}
      >
        Sharing opens up once the badge is official.
      </div>
    </Shell>
  );
}

/* ------------------------------ revoked card ------------------------------ */

function RevokedDetail({ detail }: { detail: CredentialDetail }) {
  // d9b state 3 — "REVOKED — RARE, RESPECTFUL, ACTIONABLE"
  return (
    <Shell>
      <div
        style={{
          background: "var(--color-card)",
          border: "1.5px solid var(--color-danger-border)",
          borderRadius: 16,
          padding: 16,
          textAlign: "center",
        }}
      >
        <div
          className="rl-medallion"
          style={{
            width: 64,
            height: 64,
            fontSize: 21,
            background: "var(--color-attention-bg)",
            border: "3px solid var(--color-danger-border-strong)",
            color: "var(--color-attention-fg)",
            opacity: 0.7,
          }}
        >
          {detail.monogram}
        </div>
        <div style={{ fontSize: 15, fontWeight: 800, marginTop: 9 }}>
          This badge is no longer valid
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--color-ink-subtle)",
            lineHeight: 1.55,
            marginTop: 5,
          }}
        >
          Your school withdrew &ldquo;{detail.title}&rdquo; — usually a records correction.
          Ask your adviser if this looks wrong.
        </div>
        <div style={{ fontSize: 11, color: "var(--color-ink-faint)", marginTop: 8 }}>
          It stays here grayed for your records; sharing is disabled.
        </div>
        <div
          className="rl-num"
          style={{ fontSize: 10.5, color: "var(--color-ink-faint)", marginTop: 8 }}
        >
          Control no. {detail.controlNo} · issued {fmtIssuedDate(detail.issuedAt)}
        </div>
      </div>
    </Shell>
  );
}

/* ------------------------------ official card ----------------------------- */

function RealDetail({
  detail,
  justConfirmed,
}: {
  detail: CredentialDetail;
  justConfirmed?: boolean;
}) {
  const [toast, setToast] = useState<string | null>(
    justConfirmed ? `${detail.title} is now official 🎓 — share it anytime` : null,
  );

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 3200);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(detail.verifyUrl);
      showToast("Link copied — works for anyone");
    } catch {
      showToast(detail.verifyUrl);
    }
  }

  /** Open Badges 3.0 download — the signed VC itself, <controlNo>.json. */
  function downloadVc() {
    const blob = new Blob([JSON.stringify(detail.vc, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${detail.controlNo}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <Shell>
      <div
        style={{
          background: "var(--color-card)",
          border: "1.5px solid var(--color-border)",
          borderRadius: 16,
          padding: 20,
          textAlign: "center",
        }}
      >
        <div
          className="rl-medallion"
          style={{ width: 84, height: 84, fontSize: 28, borderWidth: 3 }}
        >
          {detail.monogram}
        </div>
        <div style={{ fontSize: 19, fontWeight: 800, marginTop: 12 }}>{detail.title}</div>
        <div
          style={{
            fontSize: 12.5,
            color: "var(--color-ink-subtle)",
            lineHeight: 1.5,
            marginTop: 4,
          }}
        >
          Awarded to <b style={{ color: "var(--color-ink)" }}>{detail.holderName}</b>
          <br />
          {detail.issuerLine}
        </div>
        <div style={{ marginTop: 10 }}>
          <Chip tone="synced" size="compact" icon={<CheckMini />}>
            Official · confirmed by school
          </Chip>
        </div>
        <div
          className="rl-num"
          style={{ fontSize: 11, color: "var(--color-ink-faint)", marginTop: 8 }}
        >
          Control no. {detail.controlNo} · issued {fmtIssuedDate(detail.issuedAt)}
        </div>

        <div style={qrPanelStyle}>
          <div style={{ flexShrink: 0 }}>
            <QrCode value={detail.verifyUrl} size={84} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700 }}>Scan to verify</div>
            <Link
              href={`/verify/${detail.verifyCode}`}
              style={{
                display: "block",
                fontSize: 10.5,
                color: "var(--color-ink-subtle)",
                lineHeight: 1.5,
                marginTop: 2,
                textDecoration: "none",
                overflowWrap: "anywhere",
              }}
            >
              {detail.verifyUrl.replace(/^https?:\/\//, "")}
            </Link>
            <div style={{ fontSize: 10, color: "var(--color-ink-faint)", marginTop: 3 }}>
              Works for anyone — no app needed.
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 9 }}>
        <Button
          style={{ flex: 1, fontSize: 13.5, fontWeight: 800 }}
          onClick={() => void copyLink()}
        >
          Copy link
        </Button>
        <Button
          variant="quiet"
          onClick={downloadVc}
          style={{
            flex: 1,
            fontSize: 13.5,
            fontWeight: 800,
            border: "1.5px solid var(--color-primary)",
          }}
        >
          Badge file
        </Button>
      </div>

      <div
        style={{
          fontSize: 11,
          color: "var(--color-ink-subtle)",
          textAlign: "center",
          padding: "0 4px",
        }}
      >
        Sharing sends only the badge — never your grades or ID. The badge file
        is the signed Open Badges record.
      </div>

      {toast ? (
        <div
          style={{
            position: "fixed",
            bottom: 84,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 45,
            width: "max-content",
            maxWidth: "calc(100% - 32px)",
          }}
        >
          <Toast>{toast}</Toast>
        </div>
      ) : null}
    </Shell>
  );
}

function CheckMini() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12.5l4.7 4.7L19.5 7" />
    </svg>
  );
}

function PhoneCheckMini() {
  return (
    <svg
      width={11}
      height={11}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
      <path d="M9.5 12l1.9 1.9 3.5-3.5" />
    </svg>
  );
}
