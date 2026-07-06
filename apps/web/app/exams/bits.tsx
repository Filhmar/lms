"use client";

/**
 * Small presentational pieces shared by the exam journey screens.
 * Values quoted from the exam-journey spec — fixed-in-both-themes values
 * (scrim, toast, flag fills, on-primary whites) stay literal.
 */

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Button, NavCell, type NavCellState } from "@rl/ui";
import type { Answer } from "./state";

/* ---------- style constants ---------- */

export const SUB = "var(--color-ink-subtle)";

export const card: CSSProperties = {
  background: "var(--color-card)",
  border: "1.5px solid var(--color-border)",
  borderRadius: 14,
  padding: 15,
};

export const srOnly: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

/* ---------- breakpoint fork: ≥720dp ---------- */

export function useWide(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 720px)");
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return wide;
}

/* ---------- inline icons not in the @rl/ui set ---------- */

export function ChevronLeft({ size = 20 }: { size?: number }) {
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
      aria-hidden
    >
      <path d="M14.5 5.5L8 12l6.5 6.5" />
    </svg>
  );
}

export function ArrowRight({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 12h13" />
      <path d="M12.5 6.5L18 12l-5.5 5.5" />
    </svg>
  );
}

export function BatteryLowIcon({ size = 17 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2.5" y="8" width="16" height="9" rx="2" />
      <path d="M21.5 11v3" />
      <rect x="5" y="10.5" width="3.5" height="4" fill="currentColor" stroke="none" />
    </svg>
  );
}

/* ---------- chrome back circle (44px minimum target) ---------- */

export function BackCircle({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      style={{
        width: 44,
        height: 44,
        borderRadius: "50%",
        background: "var(--color-card)",
        border: "1px solid var(--color-border)",
        color: "var(--color-ink)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        flexShrink: 0,
        padding: 0,
      }}
    >
      <ChevronLeft size={20} />
    </button>
  );
}

/* ---------- dialog shell — safe action is always primary ---------- */

export function DialogShell({
  title,
  body,
  extra,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  onDismiss,
}: {
  title: string;
  body: string;
  extra?: ReactNode;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel: string;
  onSecondary: () => void;
  onDismiss: () => void;
}) {
  return (
    <>
      <div className="scrim" onClick={onDismiss} />
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} style={{ padding: 20 }}>
        <div style={{ fontSize: 17, fontWeight: 800 }}>{title}</div>
        <div style={{ fontSize: 13.5, lineHeight: 1.55, color: SUB, marginTop: 7 }}>{body}</div>
        {extra}
        <Button
          style={{ width: "100%", height: 50, marginTop: 15, fontSize: 15, fontWeight: 800 }}
          onClick={onPrimary}
        >
          {primaryLabel}
        </Button>
        <Button
          variant="quiet"
          style={{ width: "100%", height: 44, fontSize: 14, fontWeight: 700, color: SUB }}
          onClick={onSecondary}
        >
          {secondaryLabel}
        </Button>
      </div>
    </>
  );
}

/* ---------- question palette grid (sheet, rail, review card) ---------- */

export function PaletteGrid({
  answers,
  flags,
  cur,
  showCurrent = false,
  cols = 6,
  cellH = 46,
  onPick,
}: {
  answers: Answer[];
  flags: boolean[];
  cur: number;
  /** Ring on the current question — only while taking / palette open. */
  showCurrent?: boolean;
  cols?: number;
  cellH?: number;
  onPick: (i: number) => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 8 }}>
      {answers.map((a, i) => {
        const answered = a !== null && a !== "";
        const flagged = flags[i] ?? false;
        const state: NavCellState =
          answered && flagged
            ? "answered-flagged"
            : answered
              ? "answered"
              : flagged
                ? "flagged"
                : "unanswered";
        const isCur = showCurrent && i === cur;
        return (
          <NavCell
            key={i}
            number={i + 1}
            state={state}
            onClick={() => onPick(i)}
            aria-current={isCur ? "true" : undefined}
            aria-label={`Question ${i + 1}${answered ? ", answered" : ", blank"}${flagged ? ", flagged" : ""}`}
            style={{
              width: "100%",
              height: cellH,
              ...(isCur ? { outline: "2.5px solid var(--color-ink)", outlineOffset: 2 } : null),
            }}
          />
        );
      })}
    </div>
  );
}

/* ---------- status timeline circle ---------- */

export type StepKind = "done" | "active" | "waiting" | "pending";

export function StepCircle({ kind }: { kind: StepKind }) {
  if (kind === "pending") {
    return (
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: "50%",
          border: "2px dashed var(--color-ink-subtle)",
          opacity: 0.55,
          flexShrink: 0,
        }}
      />
    );
  }
  const cfg =
    kind === "done"
      ? { bg: "var(--color-synced-bg)", fg: "var(--color-synced-solid)", icon: "check" as const }
      : kind === "active"
        ? { bg: "var(--color-sending-bg)", fg: "var(--color-sending-fg)", icon: "send" as const }
        : {
            bg: "var(--color-on-device-bg)",
            fg: "var(--color-on-device-solid)",
            icon: "phone-check" as const,
          };
  return (
    <div
      style={{
        width: 26,
        height: 26,
        borderRadius: "50%",
        background: cfg.bg,
        color: cfg.fg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <StepIcon name={cfg.icon} />
    </div>
  );
}

function StepIcon({ name }: { name: "check" | "send" | "phone-check" }) {
  const common = {
    width: 13,
    height: 13,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  if (name === "check")
    return (
      <svg {...common} strokeWidth={3}>
        <path d="M5 12.5l4.7 4.7L19.5 7" />
      </svg>
    );
  if (name === "send")
    return (
      <svg {...common} strokeWidth={2.6}>
        <path d="M12 19.5V5.5" />
        <path d="M6.5 11L12 5.5 17.5 11" />
      </svg>
    );
  return (
    <svg {...common} strokeWidth={2.4}>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
      <path d="M9.5 12l1.9 1.9 3.5-3.5" />
    </svg>
  );
}

export function TimelineStep({
  kind,
  title,
  desc,
  last = false,
}: {
  kind: StepKind;
  title: string;
  desc: string;
  last?: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: 12 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <StepCircle kind={kind} />
        {!last ? (
          <div style={{ width: 2, flex: 1, background: "var(--color-border)", margin: "4px 0" }} />
        ) : null}
      </div>
      <div style={{ flex: 1, paddingBottom: last ? 0 : 16, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 12, color: SUB, marginTop: 2 }}>{desc}</div>
      </div>
    </div>
  );
}

/* ---------- review summary stat ---------- */

export function StatCol({
  value,
  suffix,
  caption,
  color,
}: {
  value: number;
  suffix?: string;
  caption: string;
  color?: string;
}) {
  return (
    <div>
      <div className="rl-num" style={{ fontSize: 24, fontWeight: 800, color }}>
        {value}
        {suffix ? (
          <span style={{ fontSize: 14, color: SUB, fontWeight: 600 }}>{suffix}</span>
        ) : null}
      </div>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: SUB }}>{caption}</div>
    </div>
  );
}
