"use client";

/**
 * Credential wallet — key screen p4a + deep dive d9a/d9b/d9d.
 * Badge grid with the official vs "claim pending sync" pair, the amber
 * pending explainer, and the certificates list. Works fully offline —
 * everything renders from device fixtures; the pending claim flips to
 * official (quiet toast) once the demo harness is online, per d9b.
 */

import Link from "next/link";
import { Banner, Chip, CredentialBadge, Icon, SyncPill, Toast } from "@rl/ui";
import { AppShell } from "@/components/app-chrome";
import { syncCenter } from "@/lib/copy";
import { BADGES, PENDING_BADGE_NAME, useClaimConfirmation } from "./badges";

const linkReset: React.CSSProperties = {
  textDecoration: "none",
  color: "inherit",
  display: "block",
};

export default function WalletPage() {
  const { confirmed, toastVisible } = useClaimConfirmation();

  // "You earned Math Finisher — it's safe on this phone. It becomes official
  // once your school confirms it. No action needed." (state-language library,
  // badge name bolded per d9a)
  const pendingCopy = syncCenter.badgePending(PENDING_BADGE_NAME);
  const [copyBefore = "", copyAfter = ""] = pendingCopy.split(PENDING_BADGE_NAME);

  return (
    <AppShell>
      <div className="page-body" style={{ paddingTop: 16 }}>
        <header style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h1 style={{ flex: 1, margin: 0, fontSize: 19, fontWeight: 800 }}>My badges</h1>
          {confirmed ? (
            <SyncPill state="synced" label={syncCenter.pillAllClear} />
          ) : (
            <SyncPill state="on-device" label={syncCenter.pillResting(1)} />
          )}
        </header>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {BADGES.map((badge) => {
            if (badge.status === "revoked") {
              // d9b: a revoked badge "stays here grayed for your records".
              return (
                <Link key={badge.id} href={`/wallet/${badge.id}`} style={linkReset}>
                  <div className="rl-badge-card" style={{ height: "100%" }}>
                    <div
                      className="rl-medallion"
                      style={{
                        background: "var(--color-attention-bg)",
                        border: "2.5px solid var(--color-danger-border-strong)",
                        color: "var(--color-attention-fg)",
                        opacity: 0.7,
                      }}
                    >
                      {badge.monogram}
                    </div>
                    <div
                      style={{
                        fontSize: 13.5,
                        fontWeight: 700,
                        marginTop: 9,
                        color: "var(--color-ink-subtle)",
                      }}
                    >
                      {badge.name}
                    </div>
                    <div style={{ marginTop: 7 }}>
                      <Chip tone="attention" size="mini">
                        No longer valid
                      </Chip>
                    </div>
                  </div>
                </Link>
              );
            }
            const pending = badge.status === "pending" && !confirmed;
            return (
              <Link key={badge.id} href={`/wallet/${badge.id}`} style={linkReset}>
                <CredentialBadge
                  monogram={badge.monogram}
                  name={badge.name}
                  pending={pending}
                  style={{ height: "100%" }}
                />
              </Link>
            );
          })}
        </div>

        {!confirmed ? (
          <Banner
            tone="warning"
            style={{
              borderWidth: 1,
              borderRadius: 12,
              padding: "10px 13px",
              fontSize: 11.5,
              lineHeight: 1.55,
              color: "var(--color-on-device-fg)",
            }}
          >
            {copyBefore}
            <b>{PENDING_BADGE_NAME}</b>
            {copyAfter}
          </Banner>
        ) : null}

        <div className="rl-overline" style={{ marginTop: 4 }}>
          Certificates
        </div>

        <Link href="/certificate" style={linkReset}>
          <div className="rl-row" style={{ borderRadius: 14, padding: "12px 14px" }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: "var(--color-primary-tint)",
                color: "var(--color-primary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Icon name="qr" size={17} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Grade 7 Completion</div>
              <div style={{ fontSize: 11, color: "var(--color-ink-subtle)" }}>
                SY 2025 · QR verified · saved for offline
              </div>
            </div>
            <span style={{ color: "var(--color-primary)", fontSize: 12, fontWeight: 800 }}>
              View
            </span>
          </div>
        </Link>
      </div>

      {toastVisible ? (
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
          <Toast>{PENDING_BADGE_NAME} is now official 🎓 — share it anytime</Toast>
        </div>
      ) : null}
    </AppShell>
  );
}
