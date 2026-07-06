"use client";

/**
 * Badge detail — key screen p4b + deep dive d9b.
 * Official badge: medallion, award line, QR + verify link, share/export.
 * Pending badge: same card gated — dashed medallion, "Claim waiting to
 * send" chip, dimmed QR, Share disabled — with the d9b gating copy.
 * Revoked badge (rare): the respectful d9b card; sharing is disabled.
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { Button, Chip, Toast } from "@rl/ui";
import { AppShell } from "@/components/app-chrome";
import { credential, student } from "@/lib/fixtures";
import { BADGES, useClaimConfirmation } from "../badges";
import { FakeQr } from "../fake-qr";

const verifyUrl = `${credential.verifyHost}/c/${credential.verifyCode}`;

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

export default function BadgeDetailPage() {
  const params = useParams<{ badgeId: string }>();
  const badge = BADGES.find((b) => b.id === params.badgeId);
  const { confirmed, toastVisible } = useClaimConfirmation();

  if (!badge) {
    return (
      <Shell>
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
      </Shell>
    );
  }

  if (badge.status === "revoked") {
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
            {badge.monogram}
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
            Your school withdrew &ldquo;{badge.name}&rdquo; on Jan 12 — usually a records
            correction. Ask your adviser if this looks wrong.
          </div>
          <div style={{ fontSize: 11, color: "var(--color-ink-faint)", marginTop: 8 }}>
            It stays here grayed for your records; sharing is disabled.
          </div>
        </div>
      </Shell>
    );
  }

  const pending = badge.status === "pending" && !confirmed;

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
          className={`rl-medallion${pending ? " rl-medallion--pending" : ""}`}
          style={{ width: 84, height: 84, fontSize: 28, borderWidth: 3 }}
        >
          {badge.monogram}
        </div>
        <div style={{ fontSize: 19, fontWeight: 800, marginTop: 12 }}>{badge.name}</div>
        <div
          style={{
            fontSize: 12.5,
            color: "var(--color-ink-subtle)",
            lineHeight: 1.5,
            marginTop: 4,
          }}
        >
          Awarded to <b style={{ color: "var(--color-ink)" }}>{student.name}</b>
          <br />
          {badge.citation}
        </div>
        <div style={{ marginTop: 10 }}>
          {pending ? (
            <Chip tone="on-device" size="compact" icon={<PhoneCheckMini />}>
              Claim waiting to send
            </Chip>
          ) : (
            <Chip tone="synced" size="compact" icon={<CheckMini />}>
              Official · confirmed by school
            </Chip>
          )}
        </div>

        {pending ? (
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
        ) : null}

        <div style={qrPanelStyle}>
          <div style={pending ? { opacity: 0.35, flexShrink: 0 } : { flexShrink: 0 }}>
            <FakeQr code={verifyUrl} size={84} />
          </div>
          {pending ? (
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
          ) : (
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700 }}>Scan to verify</div>
              <Link
                href={`/verify/${credential.verifyCode}`}
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
                {credential.verifyHost}/
                <br />
                c/{credential.verifyCode}
              </Link>
              <div style={{ fontSize: 10, color: "var(--color-ink-faint)", marginTop: 3 }}>
                Works for anyone — no app needed.
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 9 }}>
        <Button
          style={{ flex: 1, fontSize: 13.5, fontWeight: 800 }}
          disabled={pending}
        >
          Share
        </Button>
        <Button
          variant="quiet"
          style={{
            flex: 1,
            fontSize: 13.5,
            fontWeight: 800,
            border: "1.5px solid var(--color-primary)",
          }}
        >
          Save image
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
        Sharing sends only the badge — never your grades or ID.
      </div>

      {badge.status === "pending" && toastVisible ? (
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
          <Toast>{badge.name} is now official 🎓 — share it anytime</Toast>
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
