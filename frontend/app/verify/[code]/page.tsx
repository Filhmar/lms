"use client";

/**
 * Public verification portal — result (d8a anatomy + d8b outcomes), REAL:
 * plain fetch of the PUBLIC GET /api/v1/verify/:code (no session, no auth
 * header — this page must work for anyone). Verdict is banner-first: color
 * + word + icon, readable at arm's length, never color alone. Outcomes:
 * VERIFIED (masked name, credential, issuer, dates, control no.), REVOKED,
 * NOT FOUND, the calm 429 rate-limited state, a no-connection state, and a
 * caution state for the (should-never-happen) signature-check miss. The
 * freshness stamp is printed on the page so screenshots age visibly.
 * Payload shows masked name, credential, scope chain, dates, status — never
 * email/phone/LRN.
 */

import { Suspense, useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { VerifyResponse } from "@rl/schemas";
import {
  MONO,
  Mono,
  PortalFooter,
  PortalFrame,
  PortalHeader,
  STRINGS,
  useLang,
  usePortalTheme,
  withLang,
  type PortalColors,
  type PortalStrings,
} from "../portal";

type Outcome =
  | "checking"
  | "verified"
  | "revoked"
  | "not-found"
  | "caution"
  | "rate"
  | "no-connection";

export default function VerifyResultPage() {
  return (
    <Suspense fallback={null}>
      <VerifyResult />
    </Suspense>
  );
}

/* ---------- small glyphs (word + icon always travel together) ---------- */

function CheckGlyph({ size, strokeWidth = 3 }: { size: number; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12.5l4.7 4.7L19.5 7" />
    </svg>
  );
}

function XGlyph({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.8}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}

function MagnifierGlyph({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5l5 5" />
    </svg>
  );
}

function ClockGlyph({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

/* ---------- pieces ---------- */

function Freshness({ t, checkedAt }: { t: PortalStrings; checkedAt: string | null }) {
  return (
    <div style={{ fontSize: 9.5, opacity: 0.85, textAlign: "right", lineHeight: 1.5 }}>
      {t.checkedJustNow}
      {checkedAt ? (
        <>
          <br />
          {checkedAt}
        </>
      ) : null}
    </div>
  );
}

function Fact({
  label,
  value,
  c,
  mono,
}: {
  label: string;
  value: ReactNode;
  c: PortalColors;
  mono?: boolean;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
      <span style={{ color: c.muted, flexShrink: 0 }}>{label}</span>
      <span
        style={{
          fontWeight: 700,
          textAlign: "right",
          ...(mono ? { fontFamily: MONO, fontSize: 12 } : null),
        }}
      >
        {value}
      </span>
    </div>
  );
}

/** "San Isidro NHS, Division of Cavite, Region IV-A" → two-line block. */
function issuerLines(issuerLine: string): ReactNode {
  const parts = issuerLine.split(", ").filter(Boolean);
  if (parts.length < 2) return issuerLine;
  return (
    <>
      {parts[0]},
      <br />
      {parts.slice(1).join(", ")}
    </>
  );
}

function VerifyResult() {
  const params = useParams<{ code: string }>();
  const lang = useLang();
  const t = STRINGS[lang];
  const c = usePortalTheme();

  let code = params.code ?? "";
  try {
    code = decodeURIComponent(code);
  } catch {
    /* keep raw value */
  }
  code = code.trim().toUpperCase();

  const [outcome, setOutcome] = useState<Outcome>("checking");
  const [data, setData] = useState<VerifyResponse | null>(null);
  // Freshness stamp — set when the registry answers, so SSR markup stays
  // deterministic. Format per d8a: "Jul 6, 2026 · 10:52 AM".
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  const runCheck = useCallback(async () => {
    setOutcome("checking");
    let res: Response;
    try {
      // PUBLIC endpoint — plain fetch, never the authed client.
      res = await fetch(`/api/v1/verify/${encodeURIComponent(code)}`);
    } catch {
      setOutcome("no-connection");
      return;
    }
    if (res.status === 429) {
      setOutcome("rate");
      return;
    }
    let body: VerifyResponse;
    try {
      body = (await res.json()) as VerifyResponse;
    } catch {
      setOutcome("no-connection");
      return;
    }
    if (!res.ok) {
      setOutcome("no-connection");
      return;
    }
    setData(body);
    const now = new Date();
    const date = now.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const time = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    setCheckedAt(`${date} · ${time}`);
    if (body.status === "not_found") setOutcome("not-found");
    else if (body.signatureValid === false) setOutcome("caution"); // should not happen
    else if (body.status === "revoked") setOutcome("revoked");
    else setOutcome("verified");
  }, [code]);

  useEffect(() => {
    if (!code) {
      setOutcome("not-found");
      return;
    }
    void runCheck();
  }, [code, runCheck]);

  // A dropped connection heals itself the moment signal returns.
  useEffect(() => {
    if (outcome !== "no-connection") return;
    const retry = () => void runCheck();
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [outcome, runCheck]);

  const bodyStyle: CSSProperties = {
    padding: "12px 14px",
    fontSize: 12,
    lineHeight: 1.6,
    color: c.body,
    background: c.card,
  };

  let verdictCard: ReactNode;
  if (outcome === "checking") {
    verdictCard = (
      <section
        style={{
          border: `1.5px solid ${c.border}`,
          borderRadius: 14,
          background: c.card,
          padding: "16px 14px",
          fontSize: 12.5,
          color: c.muted,
        }}
        role="status"
      >
        {t.checking}
      </section>
    );
  } else if (outcome === "verified" && data) {
    verdictCard = (
      <section
        style={{
          border: `2px solid ${c.verified.border}`,
          borderRadius: 14,
          overflow: "hidden",
          background: c.card,
        }}
      >
        <div
          style={{
            background: c.verified.bannerBg,
            color: c.verified.bannerFg,
            padding: 14,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: "50%",
              background: c.verified.iconBg,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <CheckGlyph size={16} />
          </span>
          <h1
            role="status"
            style={{ flex: 1, margin: 0, fontSize: 18, fontWeight: 800, letterSpacing: "0.02em" }}
          >
            {t.verdicts.verified}
          </h1>
          <Freshness t={t} checkedAt={checkedAt} />
        </div>
        <div className="portal-facts" style={{ padding: 14, fontSize: 13 }}>
          <Fact label={t.facts.holder} value={data.maskedName ?? "—"} c={c} />
          <Fact label={t.facts.credential} value={data.title ?? "—"} c={c} />
          <Fact
            label={t.facts.issuedBy}
            value={data.issuerLine ? issuerLines(data.issuerLine) : "—"}
            c={c}
          />
          <Fact
            label={t.facts.issueDate}
            value={data.issuedAt ? t.issueDate(data.issuedAt) : "—"}
            c={c}
          />
          <Fact label={t.facts.controlNo} value={data.controlNo ?? "—"} c={c} mono />
        </div>
      </section>
    );
  } else if (outcome === "revoked" && data) {
    verdictCard = (
      <section
        style={{
          border: `2px solid ${c.revoked.border}`,
          borderRadius: 14,
          overflow: "hidden",
          background: c.card,
        }}
      >
        <div
          style={{
            background: c.revoked.bannerBg,
            color: c.revoked.bannerFg,
            padding: "11px 14px",
            display: "flex",
            alignItems: "center",
            gap: 9,
          }}
        >
          <XGlyph size={17} />
          <h1 role="status" style={{ flex: 1, margin: 0, fontSize: 16, fontWeight: 800 }}>
            {t.verdicts.revoked}
          </h1>
          <Freshness t={t} checkedAt={checkedAt} />
        </div>
        <div style={bodyStyle}>
          {t.revokedBody(
            <Mono>{data.controlNo ?? code}</Mono>,
            data.issuerLine?.split(", ")[0] ?? "the issuing office",
          )}
        </div>
      </section>
    );
  } else if (outcome === "not-found") {
    verdictCard = (
      <section
        style={{
          border: `2px solid ${c.notFound.border}`,
          borderRadius: 14,
          overflow: "hidden",
          background: c.card,
        }}
      >
        <div
          style={{
            background: c.notFound.bannerBg,
            color: c.notFound.bannerFg,
            padding: "10px 14px",
            display: "flex",
            alignItems: "center",
            gap: 9,
          }}
        >
          <MagnifierGlyph size={16} />
          <h1 role="status" style={{ flex: 1, margin: 0, fontSize: 16, fontWeight: 800 }}>
            {t.verdicts.notFound}
          </h1>
          <Freshness t={t} checkedAt={checkedAt} />
        </div>
        <div style={bodyStyle}>{t.notFoundBody(<Mono>{code || "—"}</Mono>)}</div>
      </section>
    );
  } else if (outcome === "caution") {
    // signatureValid === false — should not happen; calm, actionable caution.
    verdictCard = (
      <section
        style={{
          border: `2px solid ${c.notFound.border}`,
          borderRadius: 14,
          overflow: "hidden",
          background: c.card,
        }}
      >
        <div
          style={{
            background: c.notFound.bannerBg,
            color: c.notFound.bannerFg,
            padding: "10px 14px",
            display: "flex",
            alignItems: "center",
            gap: 9,
          }}
        >
          <MagnifierGlyph size={16} />
          <h1 role="status" style={{ flex: 1, margin: 0, fontSize: 16, fontWeight: 800 }}>
            {t.verdicts.caution}
          </h1>
          <Freshness t={t} checkedAt={checkedAt} />
        </div>
        <div style={bodyStyle}>{t.cautionBody}</div>
      </section>
    );
  } else {
    const rateLike = outcome === "rate";
    verdictCard = (
      <section
        style={{
          border: `2px solid ${c.rate.border}`,
          borderRadius: 14,
          overflow: "hidden",
          background: c.card,
        }}
      >
        <div
          style={{
            background: c.rate.bannerBg,
            color: c.rate.bannerFg,
            padding: "10px 14px",
            display: "flex",
            alignItems: "center",
            gap: 9,
          }}
        >
          <ClockGlyph size={15} />
          <h1 role="status" style={{ flex: 1, margin: 0, fontSize: 15, fontWeight: 800 }}>
            {t.verdicts.rate}
          </h1>
        </div>
        <div style={bodyStyle}>{rateLike ? t.rateBody : t.connectionBody}</div>
      </section>
    );
  }

  const actionStyle: CSSProperties = {
    flex: 1,
    height: 44,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: `1.5px solid ${c.border}`,
    borderRadius: 999,
    color: c.body,
    background: "transparent",
    fontSize: 12.5,
    fontWeight: 800,
    fontFamily: "inherit",
    textDecoration: "none",
    cursor: "pointer",
  };

  return (
    <PortalFrame c={c}>
      <div className="print-area" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <PortalHeader t={t} c={c} />
        {verdictCard}
        {outcome === "verified" ? (
          <div
            style={{
              background: c.explainer,
              borderRadius: 12,
              padding: "11px 13px",
              fontSize: 11.5,
              lineHeight: 1.55,
              color: c.body,
            }}
          >
            {t.maskingNote}
          </div>
        ) : null}
      </div>

      {/* "Check another" clears state — kiosk-friendly. */}
      <div className="no-print" style={{ display: "flex", gap: 8 }}>
        <Link href={withLang("/verify", lang)} style={actionStyle}>
          {t.checkAnother}
        </Link>
        <button type="button" onClick={() => window.print()} style={actionStyle}>
          {t.printResult}
        </button>
      </div>

      <PortalFooter t={t} c={c} lang={lang} />
    </PortalFrame>
  );
}
