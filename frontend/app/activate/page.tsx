"use client";

/**
 * p1b — Account activation, wired to the phone-OTP flow:
 *   step 1  email → POST /auth/activation/request → masked phone + code sent
 *   step 2  6-digit code + new password → POST /auth/activation/confirm
 *           → LoginResponse installed via the session → role-based redirect.
 * Errors stay calm and actionable; progress lives inside the button.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Field, Icon } from "@rl/ui";
import type { ActivationRequestResponse, LoginResponse } from "@rl/schemas";
import { ApiError, apiPost } from "@/lib/api";
import { activation } from "@/lib/copy";
import { homeRouteFor, useSession } from "@/lib/session";

const MONO = "ui-monospace, Menlo, monospace";

function RuleRow({ met, children }: { met: boolean; children: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        fontSize: 12,
        color: met ? "var(--color-synced-fg)" : "var(--color-ink-subtle)",
        fontWeight: met ? 600 : 400,
      }}
    >
      {met ? (
        <Icon name="check" size={12} strokeWidth={3} />
      ) : (
        <span
          aria-hidden
          style={{
            width: 12,
            height: 12,
            border: "1.5px solid var(--color-ink-faint)",
            borderRadius: "50%",
            flexShrink: 0,
          }}
        />
      )}
      {children}
    </div>
  );
}

function CalmBanner({ tone, children }: { tone: "info" | "attention"; children: React.ReactNode }) {
  const attention = tone === "attention";
  return (
    <div
      role={attention ? "alert" : "status"}
      style={{
        background: attention ? "var(--color-attention-bg)" : "var(--color-on-device-bg)",
        border: attention ? "1.5px solid var(--color-danger-border)" : "1px solid transparent",
        borderRadius: 12,
        padding: "10px 13px",
        display: "flex",
        gap: 9,
        alignItems: "flex-start",
        color: attention ? "var(--color-attention-fg)" : "var(--color-on-device-fg)",
      }}
    >
      <span style={{ display: "inline-flex", flexShrink: 0, marginTop: 1 }}>
        <Icon name={attention ? "attention" : "phone-plain"} size={14} />
      </span>
      <span style={{ fontSize: 12.5, lineHeight: 1.5, fontWeight: 600 }}>{children}</span>
    </div>
  );
}

type Step = "email" | "code" | "done";

export default function ActivatePage() {
  const router = useRouter();
  const { adoptSession } = useSession();

  const [step, setStep] = useState<Step>("email");
  const [busy, setBusy] = useState(false);

  /* step 1 */
  const [email, setEmail] = useState("");
  const [requestError, setRequestError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [challenge, setChallenge] = useState<ActivationRequestResponse | null>(null);

  /* step 2 */
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  /* done */
  const [doneName, setDoneName] = useState("");
  const [doneRoute, setDoneRoute] = useState("/");

  const hasLength = password.length >= 8;
  const matches = repeat === password && repeat.length > 0;
  const codeOk = /^\d{6}$/.test(code);

  // `sms` until the request answers; step 1 never shows channel-specific copy.
  const t = challenge ? activation[challenge.channel] : activation.sms;

  const repeatError = !attempted
    ? undefined
    : !matches
      ? "Passwords don't match yet — repeat the same password."
      : undefined;

  async function requestCode() {
    if (busy) return;
    setRequestError(null);
    setNotFound(false);
    setBusy(true);
    try {
      const res = await apiPost<ActivationRequestResponse>("/auth/activation/request", {
        email: email.trim(),
      });
      setChallenge(res);
      setStep("code");
      setCode("");
      setConfirmError(null);
      setAttempted(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true);
      } else if (err instanceof ApiError && err.status === 429) {
        setRequestError(err.message || "That's a few tries in a row — wait a minute, then try again.");
      } else if (err instanceof ApiError) {
        setRequestError(err.message);
      } else {
        setRequestError("No connection right now — try again when you have signal.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setAttempted(true);
    if (!codeOk || !hasLength || !matches || busy) return;
    setConfirmError(null);
    setBusy(true);
    try {
      const res = await apiPost<LoginResponse>("/auth/activation/confirm", {
        email: email.trim(),
        code,
        newPassword: password,
      });
      const user = await adoptSession(res);
      setDoneName(user.fullName.split(/\s+/)[0] ?? user.fullName);
      setDoneRoute(homeRouteFor(user.role));
      setStep("done");
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setConfirmError(err.message || t.mismatch);
      } else if (err instanceof ApiError && err.status === 429) {
        setConfirmError(err.message || "That's a few tries in a row — wait a minute, then try again.");
      } else if (err instanceof ApiError) {
        setConfirmError(err.message);
      } else {
        setConfirmError("No connection right now — nothing was lost. Try again when you have signal.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      style={{
        maxWidth: 380,
        margin: "0 auto",
        minHeight: "100dvh",
        padding: "28px 20px 24px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {step === "email" ? (
        <>
          <div className="rl-overline">STEP 1 OF 2 · ACCOUNT ACTIVATION</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, marginTop: 8 }}>Activate your account</h1>
          <p style={{ fontSize: 13.5, color: "var(--color-ink-subtle)", lineHeight: 1.5, marginTop: 6 }}>
            Your school created an account for you. Enter your email and we&rsquo;ll send a 6-digit
            code to the phone number on file.
          </p>

          <form
            style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              void requestCode();
            }}
          >
            <Field
              label="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              inputMode="email"
              name="email"
            />

            {notFound ? (
              <CalmBanner tone="info">
                We couldn&rsquo;t find an account waiting for that email. Check the spelling, or ask
                your school admin to confirm the email on your account.
              </CalmBanner>
            ) : null}
            {requestError ? <CalmBanner tone="attention">{requestError}</CalmBanner> : null}

            <Button
              type="submit"
              disabled={busy || email.trim().length === 0}
              style={{ height: 52, fontSize: 15, fontWeight: 800 }}
            >
              {busy ? "Sending the code…" : "Send me the code"}
            </Button>
            <Link
              href="/login"
              style={{
                textAlign: "center",
                fontSize: 13,
                fontWeight: 700,
                color: "var(--color-primary)",
                textDecoration: "none",
                padding: 4,
              }}
            >
              Already activated? Sign in
            </Link>
          </form>
        </>
      ) : null}

      {step === "code" && challenge ? (
        <>
          <div className="rl-overline">STEP 2 OF 2 · ACCOUNT ACTIVATION</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, marginTop: 8 }}>Enter the code, set your password</h1>
          <p style={{ fontSize: 13.5, color: "var(--color-ink-subtle)", lineHeight: 1.5, marginTop: 6 }}>
            {t.sentPrefix}{" "}
            <strong style={{ color: "var(--color-ink)", fontFamily: MONO }}>{challenge.maskedPhone}</strong>
            . It works for the next {Math.max(1, Math.round(challenge.expiresInSec / 60))} minutes.
          </p>

          {challenge.devCode ? (
            <div style={{ marginTop: 8 }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 11,
                  fontWeight: 700,
                  fontFamily: MONO,
                  color: "var(--color-ink-subtle)",
                  border: "1px dashed var(--color-border)",
                  borderRadius: 999,
                  padding: "4px 10px",
                }}
              >
                dev code · {challenge.devCode}
              </span>
            </div>
          ) : null}

          <form
            style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              void confirm();
            }}
          >
            <Field
              label="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              name="code"
              style={{ fontFamily: MONO, letterSpacing: "0.2em" }}
              error={attempted && !codeOk ? t.codeHint : undefined}
            />
            <Field
              label="New password"
              type="password"
              value={password}
              autoComplete="new-password"
              onChange={(e) => setPassword(e.target.value)}
              name="new-password"
            />

            {/* Password rule checklist */}
            <div style={{ display: "flex", flexDirection: "column", gap: 5, padding: "0 4px" }}>
              <RuleRow met={hasLength}>At least 8 characters</RuleRow>
              <RuleRow met={matches}>Both passwords match</RuleRow>
            </div>

            <Field
              label="Repeat password"
              type="password"
              value={repeat}
              autoComplete="new-password"
              onChange={(e) => setRepeat(e.target.value)}
              name="repeat-password"
              error={
                attempted && !hasLength
                  ? "Make the password at least 8 characters."
                  : repeatError
              }
            />

            {confirmError ? <CalmBanner tone="attention">{confirmError}</CalmBanner> : null}

            <Button type="submit" disabled={busy} style={{ height: 52, fontSize: 15, fontWeight: 800 }}>
              {busy ? "Activating…" : "Activate my account"}
            </Button>
            <button
              type="button"
              onClick={() => {
                setStep("email");
                setChallenge(null);
              }}
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
              {t.resend}
            </button>
          </form>

          {/* Offline promise banner */}
          <div
            style={{
              marginTop: 14,
              background: "var(--color-on-device-bg)",
              borderRadius: 12,
              padding: "11px 13px",
              display: "flex",
              gap: 9,
              alignItems: "flex-start",
              color: "var(--color-on-device-fg)",
            }}
          >
            <span style={{ display: "inline-flex", flexShrink: 0, marginTop: 1 }}>
              <Icon name="phone-check" size={15} />
            </span>
            <p style={{ fontSize: 12, lineHeight: 1.5, margin: 0 }}>
              After this, you stay signed in on this phone — exams and lessons will work even with no
              signal.
            </p>
          </div>
        </>
      ) : null}

      {step === "done" ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", paddingTop: 64 }}>
          <span
            style={{
              width: 62,
              height: 62,
              borderRadius: "50%",
              background: "var(--color-synced-bg)",
              color: "var(--color-synced-fg)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="check" size={28} strokeWidth={2.6} />
          </span>
          <h1 style={{ fontSize: 22, fontWeight: 800, marginTop: 14 }}>
            You&rsquo;re all set, {doneName}
          </h1>
          <p style={{ fontSize: 13.5, color: "var(--color-ink-subtle)", lineHeight: 1.5, marginTop: 6 }}>
            Your account is active and you&rsquo;re signed in on this phone.
          </p>
          <Button
            onClick={() => router.replace(doneRoute)}
            style={{ height: 52, fontSize: 15, fontWeight: 800, marginTop: 20, width: "100%" }}
          >
            Continue
          </Button>
        </div>
      ) : null}
    </main>
  );
}
