"use client";

/**
 * p1a — Login. Cached shell: works at 0% connectivity for returning users.
 * Phone-first public/auth surface (340px design frame).
 */

import { useRouter } from "next/navigation";
import { Button, Chip, Field, Icon } from "@rl/ui";
import { useOnline } from "@/lib/demo";

const MONO = "ui-monospace, Menlo, monospace";

export default function LoginPage() {
  const router = useRouter();
  const online = useOnline();

  return (
    <main
      style={{
        maxWidth: 380,
        margin: "0 auto",
        minHeight: "100dvh",
        padding: "36px 20px 24px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {!online ? (
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
          <Chip tone="on-device" size="compact" icon={<Icon name="no-signal" size={12} />}>
            Works without signal
          </Chip>
        </div>
      ) : null}

      {/* Brand block */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        <div
          aria-hidden
          style={{
            width: 62,
            height: 62,
            border: "2px solid var(--color-primary)",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: 46,
              height: 46,
              border: "1.5px dashed var(--color-ink-faint)",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 7,
              fontFamily: MONO,
              color: "var(--color-ink-subtle)",
              textAlign: "center",
              lineHeight: 1.3,
            }}
          >
            DepEd
            <br />
            seal
          </div>
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, marginTop: 12 }}>Resilient-Learn</div>
        <div style={{ fontSize: 12.5, color: "var(--color-ink-subtle)", marginTop: 2 }}>
          Department of Education
        </div>
      </div>

      {/* Form */}
      <form
        style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          router.push("/");
        }}
      >
        <Field
          label="Learner ID or email"
          defaultValue="ana.reyes@deped.gov.ph"
          autoComplete="username"
          inputMode="email"
        />
        <Field label="Password" type="password" defaultValue="password" autoComplete="current-password" />
        <Button type="submit" style={{ height: 52, fontSize: 15, fontWeight: 800 }}>
          Sign in
        </Button>
        <button
          type="button"
          style={{
            border: "none",
            background: "none",
            cursor: "pointer",
            textAlign: "center",
            fontSize: 13,
            fontWeight: 700,
            color: "var(--color-primary)",
            fontFamily: "inherit",
            padding: 4,
          }}
        >
          Forgot password?
        </button>
      </form>

      {/* Offline reassurance banner */}
      <div
        style={{
          marginTop: 16,
          background: "var(--color-synced-bg)",
          borderRadius: 12,
          padding: "11px 13px",
          display: "flex",
          gap: 9,
          alignItems: "flex-start",
          color: "var(--color-synced-fg)",
        }}
      >
        <span style={{ display: "inline-flex", flexShrink: 0, marginTop: 1 }}>
          <Icon name="phone-check" size={15} />
        </span>
        <p style={{ fontSize: 12, lineHeight: 1.5, margin: 0 }}>
          <strong>No signal? No problem.</strong> If you&rsquo;ve signed in on this phone before, you
          can sign in and keep learning offline.
        </p>
      </div>

      {/* First-run note */}
      <p
        style={{
          marginTop: 9,
          fontSize: 11.5,
          lineHeight: 1.5,
          color: "var(--color-ink-subtle)",
          padding: "0 4px",
        }}
      >
        First time on this phone? You&rsquo;ll need a connection once to set it up.
      </p>

      {/* Shared-device footer */}
      <div
        style={{
          marginTop: "auto",
          paddingTop: 16,
          borderTop: "1px solid var(--color-border)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div style={{ display: "flex" }} aria-hidden>
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: "50%",
              background: "var(--color-primary)",
              color: "#ffffff",
              fontSize: 11,
              fontWeight: 800,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              border: "2px solid var(--color-canvas)",
            }}
          >
            AR
          </span>
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: "50%",
              background: "var(--color-storage-pages)",
              color: "#ffffff",
              fontSize: 11,
              fontWeight: 800,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              border: "2px solid var(--color-canvas)",
              marginLeft: -8,
            }}
          >
            JD
          </span>
        </div>
        <button
          type="button"
          style={{
            border: "none",
            background: "none",
            cursor: "pointer",
            fontSize: 12.5,
            fontWeight: 700,
            color: "var(--color-primary)",
            fontFamily: "inherit",
            padding: 0,
          }}
        >
          Shared device? Switch student →
        </button>
      </div>
    </main>
  );
}
