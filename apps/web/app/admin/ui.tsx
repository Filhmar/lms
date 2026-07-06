/**
 * Shared chrome for the admin desktop surfaces (1040px design frames).
 * Presentational only — safe in both server and client routes.
 */

import type { CSSProperties, ReactNode } from "react";
import { Icon, ScopeBreadcrumb, SyncPill } from "@rl/ui";

export const MONO = "ui-monospace, Menlo, monospace";

/** Full-height canvas with a centered 1040px content column. */
export function AdminShell({ topBar, children }: { topBar?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ minHeight: "100dvh", background: "var(--color-canvas)" }}>
      {topBar}
      <main style={{ maxWidth: 1040, margin: "0 auto" }}>{children}</main>
    </div>
  );
}

/**
 * White top bar: brand (or page title) + scope breadcrumb with the lock
 * note — the always-visible lateral-isolation cue — + right cluster.
 */
export function AdminTopBar({
  brand,
  title,
  ancestors,
  current,
  note,
  children,
}: {
  brand?: boolean;
  title?: string;
  ancestors: string[];
  current: string;
  note?: string;
  children?: ReactNode;
}) {
  return (
    <div style={{ background: "var(--color-card)", borderBottom: "1px solid var(--color-border)" }}>
      <div
        style={{
          maxWidth: 1040,
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 22px",
          flexWrap: "wrap",
        }}
      >
        {brand ? (
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexShrink: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: "var(--color-primary)" }}>
              Resilient-Learn
            </span>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-ink-subtle)" }}>
              Admin
            </span>
          </div>
        ) : (
          <div style={{ fontSize: 14, fontWeight: 800, flexShrink: 0 }}>{title}</div>
        )}
        <ScopeBreadcrumb
          ancestors={ancestors}
          current={current}
          note={note}
          style={{ borderRadius: 999, padding: "7px 13px" }}
        />
        {children}
      </div>
    </div>
  );
}

/** Right cluster for the top bar: green "Live" pill + staff avatar. */
export function AdminTopBarCluster({ initials = "DL" }: { initials?: string }) {
  return (
    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
      <SyncPill state="synced" label="Live" />
      <span
        aria-hidden
        style={{
          width: 34,
          height: 34,
          borderRadius: "50%",
          background: "var(--color-ink)",
          color: "#ffffff",
          fontSize: 12,
          fontWeight: 800,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {initials}
      </span>
    </div>
  );
}

/** ALL-CAPS eyebrow label (admin stat cards use 0.07em, tables 0.06em). */
export function Eyebrow({
  spacing = "0.07em",
  color,
  style,
  children,
}: {
  spacing?: string;
  color?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        fontSize: 10.5,
        fontWeight: 800,
        letterSpacing: spacing,
        textTransform: "uppercase",
        color: color ?? "var(--color-ink-subtle)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Row-level import error — an actionable object, not a log line:
 * row number, message (with the offending value in monospace), action.
 */
export function ImportErrorRow({
  row,
  message,
  badValue,
  action,
  actionColor = "var(--color-primary)",
  onAction,
}: {
  row: number;
  message: string;
  badValue?: string;
  action: string;
  actionColor?: string;
  onAction?: () => void;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--color-danger-border)",
        background: "var(--color-danger-surface)",
        borderRadius: 9,
        padding: "8px 11px",
        fontSize: 12,
        display: "flex",
        alignItems: "center",
        gap: 9,
      }}
    >
      <strong className="rl-num" style={{ flexShrink: 0 }}>
        Row {row}
      </strong>
      <span style={{ flex: 1, color: "var(--color-ink-secondary)" }}>
        {message}
        {badValue ? (
          <>
            {" — "}
            <span style={{ fontFamily: MONO }}>&quot;{badValue}&quot;</span>
          </>
        ) : null}
      </span>
      <button
        type="button"
        onClick={onAction}
        style={{
          border: "none",
          background: "none",
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: 12,
          fontWeight: 700,
          color: actionColor,
          padding: 0,
          flexShrink: 0,
        }}
      >
        {action}
      </button>
    </div>
  );
}

/** The three demo error rows shared by p1g, p1h and d6b — verbatim. */
export const IMPORT_ERROR_ROWS = [
  { row: 45, message: "email not valid", badValue: "ana@@deped" },
  { row: 302, message: "missing grade level" },
  { row: 891, message: "duplicate learner ID (row 204)" },
] as const;

/** 7×7 send-health dot + label; the dot never travels without its text. */
export function HealthDot({
  tone,
  children,
}: {
  tone: "fresh" | "lagging" | "stale";
  children: ReactNode;
}) {
  const solid =
    tone === "fresh"
      ? "var(--color-synced-solid)"
      : tone === "lagging"
        ? "var(--color-on-device-solid)"
        : "var(--color-attention-solid)";
  const text =
    tone === "fresh"
      ? "var(--color-synced-fg)"
      : tone === "lagging"
        ? "var(--color-on-device-fg)"
        : "var(--color-attention-fg)";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        aria-hidden
        style={{ width: 7, height: 7, borderRadius: "50%", background: solid, flexShrink: 0 }}
      />
      <span style={{ fontSize: 12, fontWeight: 700, color: text }}>{children}</span>
    </span>
  );
}

/** Amber hotspot row used by the admin home triage panel. */
export function HotspotRow({
  tone,
  text,
  actionHref,
  actionLabel = "View schools",
}: {
  tone: "hotspot" | "catching-up";
  text: string;
  actionHref: string;
  actionLabel?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "9px 11px",
        border: `1px solid ${tone === "hotspot" ? "var(--color-warning-border)" : "var(--color-border)"}`,
        background: tone === "hotspot" ? "var(--color-warning-surface)" : "var(--color-card)",
        borderRadius: 10,
      }}
    >
      {tone === "hotspot" ? (
        <span style={{ color: "var(--color-on-device-fg)", display: "inline-flex", flexShrink: 0 }}>
          <Icon name="attention" size={14} />
        </span>
      ) : (
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "var(--color-on-device-solid)",
            flexShrink: 0,
          }}
        />
      )}
      <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{text}</span>
      <a
        href={actionHref}
        style={{
          fontSize: 11.5,
          fontWeight: 700,
          color: "var(--color-primary)",
          textDecoration: "none",
          flexShrink: 0,
        }}
      >
        {actionLabel}
      </a>
    </div>
  );
}
