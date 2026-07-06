/**
 * p4f — National sync-health view (Central). Region freshness bands as a
 * tinted tile grid (an explicit dev placeholder for a real geographic
 * map) plus the "needs attention first" triage list. Framing rule:
 * these are connectivity problems, never "missing student work".
 */

import { Icon } from "@rl/ui";
import { AdminShell, MONO } from "../ui";

type Band = "green" | "amber" | "red";

const REGIONS: { code: string; pct: string; band: Band }[] = [
  { code: "NCR", pct: "99%", band: "green" },
  { code: "CAR", pct: "96%", band: "green" },
  { code: "I", pct: "97%", band: "green" },
  { code: "II", pct: "95%", band: "green" },
  { code: "III", pct: "98%", band: "green" },
  { code: "IV-A", pct: "97%", band: "green" },
  { code: "IV-B", pct: "88%", band: "amber" },
  { code: "V", pct: "86%", band: "amber" },
  { code: "VI", pct: "94%", band: "green" },
  { code: "VII", pct: "95%", band: "green" },
  { code: "VIII", pct: "71%", band: "red" },
  { code: "IX", pct: "87%", band: "amber" },
  { code: "X", pct: "93%", band: "green" },
  { code: "XI", pct: "94%", band: "green" },
  { code: "XII", pct: "89%", band: "amber" },
  { code: "XIII", pct: "92%", band: "green" },
  { code: "BARMM", pct: "64%", band: "red" },
];

const BAND_STYLES: Record<Band, { bg: string; border: string; pct: string }> = {
  green: { bg: "#EEF9F1", border: "var(--color-success-border)", pct: "var(--color-synced-fg)" },
  amber: { bg: "var(--color-warning-surface)", border: "var(--color-pending-border)", pct: "var(--color-on-device-fg)" },
  red: { bg: "#FDF3F2", border: "var(--color-danger-border)", pct: "var(--color-attention-fg)" },
};

function LegendSwatch({ color, textColor, label }: { color: string; textColor: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: textColor }}>
      <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: color, flexShrink: 0 }} />
      {label}
    </span>
  );
}

function AttentionItem({
  tone,
  title,
  detail,
}: {
  tone: "red" | "amber";
  title: string;
  detail: string;
}) {
  return (
    <div
      style={{
        border: `1px solid ${tone === "red" ? "var(--color-danger-border)" : "var(--color-pending-border)"}`,
        background: tone === "red" ? "var(--color-danger-surface)" : "var(--color-warning-surface)",
        borderRadius: 10,
        padding: "10px 12px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          fontSize: 12.5,
          fontWeight: 700,
          color: tone === "red" ? "var(--color-attention-fg)" : "var(--color-on-device-fg)",
        }}
      >
        {tone === "red" ? <Icon name="attention" size={13} /> : null}
        {title}
      </div>
      <div style={{ fontSize: 11.5, color: "var(--color-ink-secondary)", marginTop: 3, lineHeight: 1.45 }}>
        {detail}
      </div>
    </div>
  );
}

export default function SyncHealthPage() {
  return (
    <AdminShell>
      <div style={{ padding: "20px 22px", minHeight: 460 }}>
        {/* Header row */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 320 }}>
            <h1 style={{ fontSize: 17, fontWeight: 800 }}>
              Connectivity &amp; send health — nationwide
            </h1>
            <div style={{ fontSize: 12, color: "var(--color-ink-subtle)", marginTop: 2 }}>
              Central scope · how long since schools&rsquo; work last arrived · updated 10:45 AM
            </div>
          </div>
          <div style={{ display: "flex", gap: 14, alignItems: "center", paddingTop: 4 }}>
            <LegendSwatch color="var(--color-synced-solid)" textColor="var(--color-synced-fg)" label="fresh < 4 h" />
            <LegendSwatch color="var(--color-on-device-solid)" textColor="var(--color-on-device-fg)" label="lagging < 24 h" />
            <LegendSwatch color="var(--color-attention-solid)" textColor="var(--color-attention-fg)" label="stale > 72 h" />
          </div>
        </div>

        {/* Main grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 12, marginTop: 16 }}>
          {/* Region tile grid */}
          <div
            style={{
              background: "var(--color-card)",
              border: "1px solid var(--color-border)",
              borderRadius: 14,
              padding: 16,
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8 }}>
              {REGIONS.map((r) => {
                const band = BAND_STYLES[r.band];
                return (
                  <div
                    key={r.code}
                    style={{
                      borderRadius: 10,
                      padding: "10px 8px",
                      textAlign: "center",
                      background: band.bg,
                      border: `1px solid ${band.border}`,
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 800 }}>{r.code}</div>
                    <div
                      className="rl-num"
                      style={{ fontSize: 10, fontWeight: 700, marginTop: 3, color: band.pct }}
                    >
                      {r.pct}
                    </div>
                  </div>
                );
              })}
              {/* 18th cell — geo map drop-in placeholder */}
              <div
                aria-hidden
                style={{
                  borderRadius: 10,
                  padding: "10px 8px",
                  textAlign: "center",
                  border: "1.5px dashed var(--color-border-strong)",
                  fontSize: 8.5,
                  fontFamily: MONO,
                  color: "var(--color-ink-faint)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  lineHeight: 1.4,
                }}
              >
                geo map
                <br />
                drop-in
              </div>
            </div>
            <p
              style={{
                fontSize: 11.5,
                color: "var(--color-ink-subtle)",
                lineHeight: 1.5,
                marginTop: 12,
                marginBottom: 0,
              }}
            >
              % of schools whose work arrived in the last 24 h. Tiles → drill into regions you
              govern; a real geographic map replaces this grid in production.
            </p>
          </div>

          {/* Needs attention first */}
          <div
            style={{
              background: "var(--color-card)",
              border: "1px solid var(--color-border)",
              borderRadius: 14,
              padding: 16,
            }}
          >
            <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 10 }}>
              Needs attention first
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <AttentionItem
                tone="red"
                title="Division of Sulu (BARMM)"
                detail="42 schools > 72 h · typhoon aftermath · 3,804 exams safe on devices"
              />
              <AttentionItem
                tone="red"
                title="Eastern Samar (VIII)"
                detail="28 schools > 72 h · fiber cut reported · repair ETA Jul 8"
              />
              <AttentionItem
                tone="amber"
                title="Occidental Mindoro (IV-B)"
                detail="rolling brownouts · schools sending in bursts overnight"
              />
            </div>
            <p
              style={{
                fontSize: 11.5,
                color: "var(--color-ink-subtle)",
                lineHeight: 1.5,
                marginTop: 10,
                marginBottom: 0,
              }}
            >
              Framing rule: these are <strong>connectivity</strong> problems, never &quot;missing
              student work&quot;. Devices hold everything.
            </p>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
