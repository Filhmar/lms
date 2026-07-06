import type { HTMLAttributes, ButtonHTMLAttributes } from "react";
import { Icon } from "./icons";

/* ---------- Timer — calm escalation, no blinking ----------
   Escalates by tint + label + border, never by animation.
   At 0:00 the exam auto-submits locally — work is already saved. */

export type TimerPhase = "normal" | "warning" | "critical";

export interface TimerPillProps extends HTMLAttributes<HTMLDivElement> {
  /** formatted mm:ss — rendered with tabular numerals */
  value: string;
  phase?: TimerPhase;
  /** "time left" | "5 min left" | "almost up — auto-submits" */
  label: string;
}

export function TimerPill({ value, phase = "normal", label, className = "", ...props }: TimerPillProps) {
  const phaseClass =
    phase === "warning" ? " rl-timer--warning" : phase === "critical" ? " rl-timer--critical" : "";
  return (
    <div className={`rl-timer${phaseClass} ${className}`.trim()} {...props}>
      <span className="rl-timer__value">{value}</span>
      <span className="rl-timer__label">{label}</span>
    </div>
  );
}

/* ---------- Question navigator — cells 44px minimum ----------
   Flag glyph + fill differences mean states survive grayscale. */

export type NavCellState =
  | "unanswered"
  | "answered"
  | "flagged"
  | "answered-flagged"
  | "current";

export interface NavCellProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  number: number;
  state: NavCellState;
}

export function NavCell({ number, state, className = "", ...props }: NavCellProps) {
  const stateClass =
    state === "answered" || state === "answered-flagged"
      ? " rl-navcell--answered"
      : state === "flagged"
        ? " rl-navcell--flagged"
        : state === "current"
          ? " rl-navcell--current"
          : "";
  const flagged = state === "flagged" || state === "answered-flagged";
  return (
    <button
      type="button"
      className={`rl-navcell${stateClass} ${className}`.trim()}
      aria-current={state === "current" ? "true" : undefined}
      {...props}
    >
      {number}
      {flagged ? (
        <span
          className="rl-navcell__flag"
          style={{ color: state === "answered-flagged" ? "var(--color-flag-on-primary)" : "var(--color-on-device-solid)" }}
        >
          <Icon name="flag-fill" size={10} />
        </span>
      ) : null}
    </button>
  );
}
