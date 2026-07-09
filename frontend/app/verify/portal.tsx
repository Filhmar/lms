"use client";

/**
 * Shared chrome, colors, and strings for the public verification portal (d8).
 *
 * Standalone PUBLIC surface: white page, no auth, no session, no app shell —
 * in production this ships from the separate `verify` origin; the in-app
 * copy talks to the same public GET /api/v1/verify/:code. Dark follows the
 * visitor's device setting (prefers-color-scheme); the verdict banners keep
 * their hue in both themes (d8c). The EN/FIL toggle persists via URL param
 * only (d8notes) — zero settings, zero state.
 *
 * FIL strings are drafts for translator review (State Language §5): plain,
 * neutral register for a public government surface. The response never
 * contains email/phone/LRN — masked name, credential, scope chain, dates,
 * status only.
 */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

export const MONO = "ui-monospace, Menlo, monospace";

export type Lang = "en" | "fil";

/** Seeded demo codes — reviewer aid on the landing page only. */
export const DEMO_CODE_VERIFIED = "8KX2-94QF";
export const DEMO_CODE_REVOKED = "8KX2-94QG";

/** Mono inline run (codes, control numbers, formats). */
export function Mono({ children }: { children: ReactNode }) {
  return <span style={{ fontFamily: MONO }}>{children}</span>;
}

/* ---------- colors (light per d8a/d8b, dark per d8c) ---------- */

export interface PortalColors {
  page: string;
  desk: string;
  ink: string;
  body: string;
  muted: string;
  faint: string;
  border: string;
  hairline: string;
  card: string;
  explainer: string;
  seal: string;
  link: string;
  input: string;
  check: string;
  verified: { border: string; bannerBg: string; bannerFg: string; iconBg: string };
  revoked: { border: string; bannerBg: string; bannerFg: string };
  notFound: { border: string; bannerBg: string; bannerFg: string };
  rate: { border: string; bannerBg: string; bannerFg: string };
}

const LIGHT: PortalColors = {
  page: "#FFFFFF",
  desk: "#EEF1F7",
  ink: "#1A2233",
  body: "#3D4A66",
  muted: "#5B6B8C",
  faint: "#93A3C4",
  border: "#C9D1E0",
  hairline: "#E6EAF2",
  card: "#FFFFFF",
  explainer: "#F4F6FA",
  seal: "#1E4AC2",
  link: "#1E4AC2",
  input: "#1E4AC2",
  check: "#1E4AC2",
  verified: { border: "#1A7F37", bannerBg: "#1A7F37", bannerFg: "#FFFFFF", iconBg: "rgba(255,255,255,0.22)" },
  revoked: { border: "#C0362C", bannerBg: "#C0362C", bannerFg: "#FFFFFF" },
  notFound: { border: "#C9D1E0", bannerBg: "#E9EDF5", bannerFg: "#3D4A66" },
  rate: { border: "#E5C88F", bannerBg: "#FFF4E3", bannerFg: "#8A4E06" },
};

const DARK: PortalColors = {
  page: "#0C1322",
  desk: "#0C1322",
  ink: "#E7EDF9",
  body: "#B9C6E0",
  muted: "#93A3C4",
  faint: "#6B7BA0",
  border: "#263352",
  hairline: "#263352",
  card: "#131C31",
  explainer: "#131C31",
  seal: "#4D77E8",
  link: "#8FB0FF",
  input: "#4D77E8",
  check: "#4D77E8",
  verified: { border: "#2EA043", bannerBg: "#12291B", bannerFg: "#57D07A", iconBg: "rgba(87,208,122,0.18)" },
  revoked: { border: "#C0362C", bannerBg: "#C0362C", bannerFg: "#FFFFFF" },
  notFound: { border: "#263352", bannerBg: "#182441", bannerFg: "#B9C6E0" },
  rate: { border: "#5C4416", bannerBg: "#2E2110", bannerFg: "#F0B458" },
};

/** Device theme (d8: dark follows the visitor's setting — no toggle). */
export function usePortalTheme(): PortalColors {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setDark(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return dark ? DARK : LIGHT;
}

/* ---------- strings ---------- */

export interface PortalStrings {
  tagline: string;
  entryTitle: string;
  check: string;
  entryHint: string;
  verdicts: {
    verified: string;
    revoked: string;
    notFound: string;
    rate: string;
    caution: string;
  };
  checking: string;
  checkedJustNow: string;
  facts: { holder: string; credential: string; issuedBy: string; issueDate: string; controlNo: string };
  issueDate: (iso: string) => string;
  maskingNote: string;
  checkAnother: string;
  printResult: string;
  reportProblem: string;
  revokedBody: (controlNo: ReactNode, issuer: string) => ReactNode;
  notFoundBody: (code: ReactNode) => ReactNode;
  cautionBody: ReactNode;
  rateBody: ReactNode;
  connectionBody: ReactNode;
}

const FIL_MONTHS = [
  "Enero",
  "Pebrero",
  "Marso",
  "Abril",
  "Mayo",
  "Hunyo",
  "Hulyo",
  "Agosto",
  "Setyembre",
  "Oktubre",
  "Nobyembre",
  "Disyembre",
] as const;

export const STRINGS: Record<Lang, PortalStrings> = {
  en: {
    tagline: "verify.deped.gov.ph — official government service",
    entryTitle: "Camera not working? Type the code",
    check: "Check",
    entryHint: "Found under the QR on every certificate.",
    verdicts: {
      verified: "VERIFIED",
      revoked: "REVOKED",
      notFound: "NOT FOUND",
      rate: "ONE MOMENT",
      caution: "CAN’T CONFIRM",
    },
    checking: "Checking the registry…",
    checkedJustNow: "checked just now",
    facts: {
      holder: "Holder",
      credential: "Credential",
      issuedBy: "Issued by",
      issueDate: "Issue date",
      controlNo: "Control no.",
    },
    issueDate: (iso) =>
      new Date(iso).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
    maskingNote:
      "Names are partly hidden to protect the student — match the visible letters against the certificate in front of you.",
    checkAnother: "Check another code",
    printResult: "Print this result",
    reportProblem: "Report a problem",
    revokedBody: (controlNo, issuer) => (
      <>
        This credential ({controlNo}) was withdrawn by <b>{issuer}</b>.{" "}
        <b>Do not accept it.</b> To confirm why, contact the issuing office.
      </>
    ),
    notFoundBody: (code) => (
      <>
        No credential matches {code}. Codes look like <Mono>XXXX-XXXX</Mono> — check the
        characters under the QR. If it still fails, the certificate may not be genuine.
      </>
    ),
    cautionBody: (
      <>
        This code matched a record, but its signature could not be confirmed just now.
        Try again in a few minutes — and if this keeps happening, contact the issuing
        office before accepting the certificate.
      </>
    ),
    rateBody: (
      <>
        Too many checks from this connection. Wait <b>a minute</b> and try again — no
        action needed.
      </>
    ),
    connectionBody: (
      <>
        No connection right now — nothing was lost. Check your signal and try again in a
        moment.
      </>
    ),
  },
  // FIL drafts for translator review — plain, neutral register.
  fil: {
    tagline: "verify.deped.gov.ph — opisyal na serbisyo ng pamahalaan",
    entryTitle: "Hindi gumagana ang camera? I-type ang code",
    check: "Suriin",
    entryHint: "Makikita sa ilalim ng QR ng bawat sertipiko.",
    verdicts: {
      verified: "BERIPIKADO",
      revoked: "BINAWI",
      notFound: "HINDI NAHANAP",
      rate: "SANDALI LANG",
      caution: "HINDI PA MASIGURO",
    },
    checking: "Sinusuri sa talaan…",
    checkedJustNow: "kakasuri pa lamang",
    facts: {
      holder: "Pangalan",
      credential: "Kredensyal",
      issuedBy: "Inisyu ng",
      issueDate: "Petsa ng isyu",
      controlNo: "Control no.",
    },
    issueDate: (iso) => {
      const d = new Date(iso);
      return `${FIL_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    },
    maskingNote:
      "Bahagyang nakatago ang pangalan upang maprotektahan ang mag-aaral — itugma ang mga nakikitang letra sa sertipikong hawak mo.",
    checkAnother: "Suriin ang ibang code",
    printResult: "I-print ang resulta",
    reportProblem: "Mag-ulat ng problema",
    revokedBody: (controlNo, issuer) => (
      <>
        Binawi ng <b>{issuer}</b> ang kredensyal na ito ({controlNo}).{" "}
        <b>Huwag itong tanggapin.</b> Upang malaman kung bakit, makipag-ugnayan sa
        naglabas na opisina.
      </>
    ),
    notFoundBody: (code) => (
      <>
        Walang kredensyal na tumutugma sa {code}. Ganito ang anyo ng mga code:{" "}
        <Mono>XXXX-XXXX</Mono> — suriin ang mga karakter sa ilalim ng QR. Kung hindi pa rin
        tumugma, maaaring hindi tunay ang sertipiko.
      </>
    ),
    cautionBody: (
      <>
        May tumugmang rekord sa code na ito, ngunit hindi pa nakumpirma ang lagda nito
        ngayon. Subukang muli pagkalipas ng ilang minuto — at kung paulit-ulit ito,
        makipag-ugnayan sa naglabas na opisina bago tanggapin ang sertipiko.
      </>
    ),
    rateBody: (
      <>
        Masyadong maraming pagsusuri mula sa koneksyong ito. Maghintay ng{" "}
        <b>isang minuto</b> at subukang muli — walang kailangang gawin.
      </>
    ),
    connectionBody: (
      <>
        Walang koneksyon ngayon — walang nawala. Suriin ang signal at subukang muli
        maya-maya.
      </>
    ),
  },
};

export function useLang(): Lang {
  const searchParams = useSearchParams();
  return searchParams.get("lang") === "fil" ? "fil" : "en";
}

/** Internal navigation that carries the language along (URL param only). */
export function withLang(path: string, lang: Lang): string {
  return lang === "fil" ? `${path}?lang=fil` : path;
}

/* ---------- chrome ---------- */

export function PortalFrame({ c, children }: { c: PortalColors; children: ReactNode }) {
  return (
    <div
      className="portal-page"
      style={{ "--pv-page": c.page, "--pv-desk": c.desk } as CSSProperties}
    >
      <div className="portal-card" style={{ color: c.ink }}>
        {children}
      </div>
      <style>{`
        .portal-page { min-height: 100dvh; background: var(--pv-page); display: flex; flex-direction: column; align-items: center; }
        .portal-card { width: 100%; max-width: 480px; flex: 1; display: flex; flex-direction: column; gap: 12px; padding: 18px 16px; background: var(--pv-page); }
        @media (min-width: 720px) {
          .portal-page { background: var(--pv-desk); padding: 26px 16px; }
          .portal-card { max-width: 460px; flex: 0 0 auto; min-height: 520px; border-radius: 16px; box-shadow: 0 8px 28px rgba(20, 30, 55, 0.10); padding: 18px; }
        }
        .portal-facts { display: flex; flex-direction: column; gap: 8px; }
        /* auth-c desktop: the result card widens (content ~760) and the
           fact list flows into two columns */
        @media (min-width: 1080px) {
          .portal-card { max-width: 720px; padding: 22px 24px; }
          .portal-facts { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 28px; }
        }
        @media print {
          body * { visibility: hidden; }
          .print-area, .print-area * { visibility: visible; }
          .print-area { position: absolute; left: 0; top: 0; width: 100%; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
}

export function PortalHeader({
  t,
  c,
  titleAs: TitleTag = "div",
}: {
  t: PortalStrings;
  c: PortalColors;
  titleAs?: "h1" | "div";
}) {
  return (
    <header style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div
        aria-hidden="true"
        style={{
          width: 30,
          height: 30,
          borderRadius: "50%",
          border: `1.5px solid ${c.seal}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 6,
          fontFamily: MONO,
          color: c.muted,
          flexShrink: 0,
        }}
      >
        DepEd
      </div>
      <div style={{ minWidth: 0 }}>
        <TitleTag style={{ margin: 0, fontSize: 13, fontWeight: 800 }}>
          DepEd Credential Check
        </TitleTag>
        <div style={{ fontSize: 10, color: c.muted }}>{t.tagline}</div>
      </div>
    </header>
  );
}

export function PortalFooter({
  t,
  c,
  lang,
}: {
  t: PortalStrings;
  c: PortalColors;
  lang: Lang;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const hrefFor = (target: Lang) => {
    const q = new URLSearchParams(searchParams.toString());
    if (target === "fil") q.set("lang", "fil");
    else q.delete("lang");
    const s = q.toString();
    return s ? `${pathname}?${s}` : pathname;
  };

  const langItem = (target: Lang, label: string) =>
    lang === target ? (
      <span aria-current="true">{label}</span>
    ) : (
      <Link href={hrefFor(target)} style={{ color: c.link, fontWeight: 700, textDecoration: "none" }}>
        {label}
      </Link>
    );

  return (
    <footer
      className="no-print"
      style={{
        marginTop: "auto",
        paddingTop: 12,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        fontSize: 10.5,
        color: c.faint,
      }}
    >
      <nav aria-label="Language" style={{ display: "flex", gap: 5, alignItems: "center" }}>
        {langItem("en", "English")}
        <span aria-hidden="true">·</span>
        {langItem("fil", "Filipino")}
      </nav>
      <span>{t.reportProblem}</span>
    </footer>
  );
}
