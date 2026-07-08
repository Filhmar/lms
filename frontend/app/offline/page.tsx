"use client";

/**
 * Offline fallback — served by the service worker when a page isn't on this
 * phone yet and there's no connection (precached at install, see app/sw.ts).
 * Calm Shelter: amber is calm, "on this phone" is safety, no jargon,
 * no blocking spinner.
 */

import { Button, Icon } from "@rl/ui";
import { environment } from "@/lib/copy";

export default function OfflinePage() {
  return (
    <main
      style={{
        maxWidth: 380,
        margin: "0 auto",
        minHeight: "100dvh",
        padding: "36px 24px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        gap: 14,
      }}
    >
      <div
        aria-hidden
        style={{
          width: 64,
          height: 64,
          borderRadius: "50%",
          background: "var(--color-on-device-bg)",
          color: "var(--color-on-device-fg)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name="no-signal" size={26} />
      </div>

      <h1 style={{ fontSize: 19, fontWeight: 800, lineHeight: 1.35, margin: 0 }}>
        {environment.offline}
      </h1>

      <p
        style={{
          fontSize: 13,
          lineHeight: 1.55,
          color: "var(--color-ink-subtle)",
          margin: 0,
        }}
      >
        This page isn&rsquo;t saved on this phone yet. Your saved work is safe —
        open it from your home screen anytime.
      </p>

      <Button
        onClick={() => window.location.reload()}
        style={{ height: 48, minWidth: 180, fontSize: 14, fontWeight: 800, marginTop: 6 }}
      >
        Try again
      </Button>
    </main>
  );
}
