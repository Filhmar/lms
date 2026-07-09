"use client";

/**
 * Credential wallet — key screen p4a + deep dive d9a/d9b/d9d, REAL:
 * GET /credentials drives the grid, with the localStorage wallet cache so
 * everything renders with zero signal (on-device chip). Pending tiles are
 * locally submitted exam attempts whose badge hasn't arrived from the
 * grading path yet — dashed medallion, "Official after next send", never
 * "unverified". A revoked credential stays grayed for the holder's records.
 */

import Link from "next/link";
import { Banner, Chip, CredentialBadge, Icon, SyncPill, Toast } from "@rl/ui";
import type { CredentialListItem } from "@rl/schemas";
import { AppShell } from "@/components/app-chrome";
import { syncCenter } from "@/lib/copy";
import { RequireAuth, useSession } from "@/lib/session";
import { useExamEngine } from "@/lib/exam/use-engine";
import {
  derivePendingClaims,
  fmtIssuedDate,
  useClaimConfirmedToast,
  useWallet,
} from "@/lib/wallet";

const linkReset: React.CSSProperties = {
  textDecoration: "none",
  color: "inherit",
  display: "block",
};

export default function WalletPage() {
  return (
    <RequireAuth>
      <WalletScreen />
    </RequireAuth>
  );
}

function WalletScreen() {
  const { user } = useSession();
  const wallet = useWallet(user?.id);
  const eng = useExamEngine();

  const badges = wallet.items.filter((c) => c.kind === "badge");
  const certificates = wallet.items.filter((c) => c.kind === "certificate");
  const pending = eng.ready ? derivePendingClaims(eng, wallet.items) : [];
  const confirmedTitle = useClaimConfirmedToast(pending, wallet.items, wallet.ready);

  if (!wallet.ready) return null;

  // "You earned {badge} — it's safe on this phone. It becomes official once
  // your school confirms it. No action needed." (state-language library)
  const firstPending = pending[0];
  const pendingCopy = firstPending ? syncCenter.badgePending(firstPending.title) : "";
  const [copyBefore = "", copyAfter = ""] = firstPending
    ? pendingCopy.split(firstPending.title)
    : ["", ""];

  const pill =
    pending.length > 0 ? (
      <SyncPill state="on-device" label={syncCenter.pillResting(pending.length)} />
    ) : wallet.live ? (
      <SyncPill state="synced" label={syncCenter.pillAllClear} />
    ) : (
      <SyncPill state="on-device" label="Saved on this phone" offline={!eng.online} />
    );

  return (
    <AppShell wide>
      <style>{walletCss}</style>
      <div className="page-body wallet-body" style={{ paddingTop: 16 }}>
        <header style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h1 style={{ flex: 1, margin: 0, fontSize: 19, fontWeight: 800 }}>My badges</h1>
          {pill}
        </header>

        {badges.length === 0 && pending.length === 0 ? (
          <div
            style={{
              border: "1.5px dashed var(--color-border)",
              borderRadius: 14,
              padding: "16px 14px",
              fontSize: 12.5,
              lineHeight: 1.5,
              color: "var(--color-ink-subtle)",
              textAlign: "center",
            }}
          >
            No badges yet — finish an exam and your badge appears here, safe on
            this phone.
          </div>
        ) : (
          <div className="wallet-grid">
            {badges.map((badge) =>
              badge.status === "revoked" ? (
                <RevokedTile key={badge.id} badge={badge} />
              ) : (
                <Link key={badge.id} href={`/wallet/${badge.id}`} style={linkReset}>
                  <CredentialBadge
                    monogram={badge.monogram}
                    name={badge.title}
                    style={{ height: "100%" }}
                  />
                </Link>
              ),
            )}
            {pending.map((claim) => (
              <Link key={claim.id} href={`/wallet/${claim.id}`} style={linkReset}>
                <CredentialBadge
                  monogram={claim.monogram}
                  name={claim.title}
                  pending
                  style={{ height: "100%" }}
                />
              </Link>
            ))}
          </div>
        )}

        {firstPending ? (
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
            <b>{firstPending.title}</b>
            {copyAfter}
          </Banner>
        ) : null}

        <div className="rl-overline" style={{ marginTop: 4 }}>
          Certificates
        </div>

        {certificates.length === 0 ? (
          <div
            style={{
              border: "1.5px dashed var(--color-border)",
              borderRadius: 14,
              padding: "13px 14px",
              fontSize: 12,
              lineHeight: 1.5,
              color: "var(--color-ink-subtle)",
            }}
          >
            No certificates yet — completing a whole course earns one.
          </div>
        ) : (
          certificates.map((cert) => (
            <Link key={cert.id} href={`/certificate?id=${cert.id}`} style={linkReset}>
              <div className="rl-row" style={{ borderRadius: 14, padding: "12px 14px" }}>
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 10,
                    background:
                      cert.status === "revoked"
                        ? "var(--color-attention-bg)"
                        : "var(--color-primary-tint)",
                    color:
                      cert.status === "revoked"
                        ? "var(--color-attention-fg)"
                        : "var(--color-primary)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Icon name="qr" size={17} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{cert.title}</div>
                  <div style={{ fontSize: 11, color: "var(--color-ink-subtle)" }}>
                    {cert.status === "revoked" ? (
                      <span style={{ color: "var(--color-attention-fg)", fontWeight: 700 }}>
                        No longer valid
                      </span>
                    ) : (
                      <>Issued {fmtIssuedDate(cert.issuedAt)} · QR verified · saved on this phone</>
                    )}
                  </div>
                </div>
                <span style={{ color: "var(--color-primary)", fontSize: 12, fontWeight: 800 }}>
                  View
                </span>
              </div>
            </Link>
          ))
        )}
      </div>

      {confirmedTitle ? (
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
          <Toast>{confirmedTitle} is now official 🎓 — share it anytime</Toast>
        </div>
      ) : null}
    </AppShell>
  );
}

/* Badge grid: 2-up on phones (unchanged), 3-up at the desktop width
   (lrn-c); the wallet column caps at ~980 so cards keep their shape. */
const walletCss = `
.wallet-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
@media (min-width:1080px){
  .wallet-body{max-width:980px;margin:0 auto;width:100%;}
  .wallet-grid{grid-template-columns:repeat(3,1fr);gap:12px;}
}
`;

/** d9b: a revoked badge "stays here grayed for your records". */
function RevokedTile({ badge }: { badge: CredentialListItem }) {
  return (
    <Link href={`/wallet/${badge.id}`} style={linkReset}>
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
          {badge.title}
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
