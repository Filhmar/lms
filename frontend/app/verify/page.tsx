"use client";

/**
 * Public verification portal — landing (p4d + d8 manual entry).
 * No login, no session, no cookies banner, no app chrome — a government
 * header, one code field, one button. Typing the code is the camera
 * fallback (a real QR scan lands directly on /verify/c/{code}).
 */

import { Suspense, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  DEMO_CODE_REVOKED,
  DEMO_CODE_VERIFIED,
  MONO,
  Mono,
  PortalFooter,
  PortalFrame,
  PortalHeader,
  STRINGS,
  useLang,
  usePortalTheme,
  withLang,
} from "./portal";

export default function VerifyLandingPage() {
  return (
    <Suspense fallback={null}>
      <VerifyLanding />
    </Suspense>
  );
}

function VerifyLanding() {
  const lang = useLang();
  const t = STRINGS[lang];
  const c = usePortalTheme();
  const router = useRouter();
  // Prefilled with the seeded demo code — reviewer aid for the prototype.
  const [code, setCode] = useState<string>(DEMO_CODE_VERIFIED);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const normalized = code.trim().toUpperCase();
    if (!normalized) return;
    router.push(withLang(`/verify/${encodeURIComponent(normalized)}`, lang));
  }

  return (
    <PortalFrame c={c}>
      <PortalHeader t={t} c={c} titleAs="h1" />

      <section
        style={{
          border: `1.5px solid ${c.border}`,
          borderRadius: 14,
          padding: 14,
          background: c.card,
          marginTop: 4,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 12.5, fontWeight: 800 }}>{t.entryTitle}</h2>
        <form onSubmit={onSubmit} style={{ display: "flex", gap: 8, marginTop: 9 }}>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            aria-label={t.entryTitle}
            placeholder="XXXX-XXXX"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={12}
            style={{
              flex: 1,
              minWidth: 0,
              height: 46,
              border: `2px solid ${c.input}`,
              borderRadius: 10,
              padding: "0 13px",
              fontSize: 16,
              fontFamily: MONO,
              letterSpacing: "0.08em",
              background: c.card,
              color: c.ink,
            }}
          />
          <button
            type="submit"
            style={{
              height: 46,
              padding: "0 16px",
              background: c.check,
              color: "#ffffff",
              border: "none",
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 800,
              fontFamily: "inherit",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {t.check}
          </button>
        </form>
        <div style={{ fontSize: 10.5, color: c.faint, marginTop: 7 }}>{t.entryHint}</div>
      </section>

      {/* Reviewer aid for the prototype only — the seeded demo credentials. */}
      <p style={{ margin: 0, fontSize: 10, color: c.faint }}>
        Demo codes: <Mono>{DEMO_CODE_VERIFIED}</Mono> verified ·{" "}
        <Mono>{DEMO_CODE_REVOKED}</Mono> revoked · any other code not found.
      </p>

      <PortalFooter t={t} c={c} lang={lang} />
    </PortalFrame>
  );
}
