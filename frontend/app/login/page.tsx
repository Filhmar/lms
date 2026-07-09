"use client";

/**
 * p1a — Login, wired to POST /api/v1/auth/login via the session provider.
 * Cached shell: works at 0% connectivity for returning users. Errors are
 * inline and actionable; progress lives inside the button (never a page
 * spinner). Admins land on /admin, everyone else on /.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Chip, Field, Icon } from "@rl/ui";
import { ApiError } from "@/lib/api";
import { environment } from "@/lib/copy";
import { homeRouteFor, useSession } from "@/lib/session";

const MONO = "ui-monospace, Menlo, monospace";

/** Real browser connectivity (no demo harness on this surface). */
function useBrowserOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

export default function LoginPage() {
  const router = useRouter();
  const online = useBrowserOnline();
  const { status, user, login } = useSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showActivateLink, setShowActivateLink] = useState(false);

  /* ?resume=1 — a signed-in-offline session ended while work is still on the
     phone. window.location (not useSearchParams) keeps this page a plain
     client shell with no Suspense requirement. */
  const [resumeHint, setResumeHint] = useState(false);
  useEffect(() => {
    setResumeHint(new URLSearchParams(window.location.search).get("resume") === "1");
  }, []);

  /* Already signed in (e.g. back button) → straight to the right home. */
  useEffect(() => {
    if (status === "authed" && user) router.replace(homeRouteFor(user.role));
  }, [status, user, router]);

  async function submit() {
    if (busy) return;
    setError(null);
    setShowActivateLink(false);
    setBusy(true);
    try {
      const signedIn = await login(email.trim(), password);
      router.replace(homeRouteFor(signedIn.role));
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setError("That email and password don't match.");
        } else if (err.status === 403) {
          setError(err.message);
          if (/pending|activat/i.test(err.message)) setShowActivateLink(true);
        } else {
          setError(err.message);
        }
      } else {
        setError(
          "No connection right now — if you've signed in on this phone before, connect once to sign in again.",
        );
      }
    }
  }

  return (
    <div className="login-page">
      <style>{loginCss}</style>
      <main className="login-card">
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

      {/* Session ended while work is safe on this phone — calm reassurance */}
      {resumeHint ? (
        <div
          role="status"
          style={{
            marginTop: 18,
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
          <p style={{ fontSize: 12.5, lineHeight: 1.5, margin: 0, fontWeight: 700 }}>
            {environment.sessionExpired}
          </p>
        </div>
      ) : null}

      {/* Form */}
      <form
        style={{ marginTop: resumeHint ? 14 : 24, display: "flex", flexDirection: "column", gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field
          label="Learner ID or email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          inputMode="email"
          name="email"
        />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          name="password"
        />

        {error ? (
          <div
            role="alert"
            style={{
              background: "var(--color-attention-bg)",
              border: "1.5px solid var(--color-danger-border)",
              borderRadius: 12,
              padding: "10px 13px",
              display: "flex",
              gap: 9,
              alignItems: "flex-start",
              color: "var(--color-attention-fg)",
            }}
          >
            <span style={{ display: "inline-flex", flexShrink: 0, marginTop: 1 }}>
              <Icon name="attention" size={14} />
            </span>
            <span style={{ fontSize: 12.5, lineHeight: 1.5, fontWeight: 600 }}>
              {error}
              {showActivateLink ? (
                <>
                  {" "}
                  <Link
                    href="/activate"
                    style={{ color: "var(--color-primary)", fontWeight: 800 }}
                  >
                    Activate your account →
                  </Link>
                </>
              ) : null}
            </span>
          </div>
        ) : null}

        <Button
          type="submit"
          disabled={busy || email.trim().length === 0 || password.length === 0}
          style={{ height: 52, fontSize: 15, fontWeight: 800 }}
        >
          {busy ? "Signing in…" : "Sign in"}
        </Button>
        <Link
          href="/activate"
          style={{
            textAlign: "center",
            fontSize: 13,
            fontWeight: 700,
            color: "var(--color-primary)",
            textDecoration: "none",
            padding: 4,
          }}
        >
          First time here? Activate your account
        </Link>
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
      </main>
    </div>
  );
}

/* Phone layout unchanged; at ≥720px the form becomes the auth-a card
   (radius 18, login shadow from the §2.11 whitelist) on the canvas. */
const loginCss = `
.login-card{max-width:380px;margin:0 auto;min-height:100dvh;padding:36px 20px 24px;display:flex;flex-direction:column;width:100%;}
@media (min-width:720px){
  .login-page{min-height:100dvh;display:flex;align-items:flex-start;justify-content:center;padding:56px 16px 32px;}
  .login-card{min-height:0;max-width:420px;width:100%;margin:0;background:var(--color-card);border:1px solid var(--color-border);border-radius:18px;box-shadow:var(--shadow-login);padding:26px;}
}
`;
