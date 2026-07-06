"use client";

/**
 * p1b — Account activation. A bulk-imported user's first touch:
 * pending_activation → set password → first login. Live password-rule
 * checklist; the default value reproduces the design's mid-typing state
 * (2 of 3 rules met — the password still contains the learner's name).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Icon, Toast } from "@rl/ui";

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

export default function ActivatePage() {
  const router = useRouter();
  const [password, setPassword] = useState("ana2010rey");
  const [repeat, setRepeat] = useState("ana201");
  const [attempted, setAttempted] = useState(false);
  const [done, setDone] = useState(false);

  const hasLength = password.length >= 8;
  const hasNumber = /\d/.test(password);
  const notPersonal = password.length > 0 && !/ana|reyes|2010/i.test(password);
  const rulesMet = hasLength && hasNumber && notPersonal;
  const matches = repeat === password && repeat.length > 0;

  const repeatError = !attempted
    ? undefined
    : !rulesMet
      ? "Check the rules above — the password can't be your name or birthday."
      : !matches
        ? "Passwords don't match yet — repeat the same password."
        : undefined;

  function activate() {
    setAttempted(true);
    if (rulesMet && matches) {
      setDone(true);
      window.setTimeout(() => router.push("/"), 1100);
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
      <div className="rl-overline">STEP 2 OF 2 · ACCOUNT ACTIVATION</div>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginTop: 8 }}>Hi Ana! Set your password</h1>
      <p style={{ fontSize: 13.5, color: "var(--color-ink-subtle)", lineHeight: 1.5, marginTop: 6 }}>
        Your school created this account for{" "}
        <strong style={{ color: "var(--color-ink)" }}>ana.reyes@deped.gov.ph</strong> at San Isidro
        National High School.
      </p>

      <form
        style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          activate();
        }}
      >
        <Field
          label="New password"
          type="password"
          value={password}
          autoComplete="new-password"
          onChange={(e) => setPassword(e.target.value)}
        />

        {/* Password rule checklist */}
        <div style={{ display: "flex", flexDirection: "column", gap: 5, padding: "0 4px" }}>
          <RuleRow met={hasLength}>At least 8 characters</RuleRow>
          <RuleRow met={hasNumber}>Has a number</RuleRow>
          <RuleRow met={notPersonal}>Not your name or birthday</RuleRow>
        </div>

        <Field
          label="Repeat password"
          type="password"
          value={repeat}
          autoComplete="new-password"
          onChange={(e) => setRepeat(e.target.value)}
          error={repeatError}
        />

        <Button type="submit" style={{ height: 52, fontSize: 15, fontWeight: 800 }}>
          Activate my account
        </Button>
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

      {done ? (
        <div style={{ position: "fixed", bottom: 24, left: 0, right: 0, display: "flex", justifyContent: "center", zIndex: 60 }}>
          <Toast>Account activated — you&rsquo;re signed in on this phone</Toast>
        </div>
      ) : null}
    </main>
  );
}
