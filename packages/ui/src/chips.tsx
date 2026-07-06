import type { HTMLAttributes, ReactNode } from "react";
import { Icon } from "./icons";
import { WORK_STATE_ICON, type WorkState } from "./sync";

export interface SyncPillProps extends HTMLAttributes<HTMLElement> {
  state: WorkState;
  /** e.g. "Up to date" · "On this phone · 8" · "Sending 4/12…" · "Needs Wi-Fi" */
  label: string;
  /** Appends the no-signal glyph (offline while work waits on device). */
  offline?: boolean;
  /** Chrome variant: the always-visible pill in the app bar (8px 13px padding). */
  chrome?: boolean;
  iconSize?: number;
  as?: "span" | "button";
}

/** Sync pill — always in app chrome; tap opens the Sync Center. */
export function SyncPill({
  state,
  label,
  offline,
  chrome,
  iconSize = 13,
  as: Tag = "span",
  className = "",
  ...props
}: SyncPillProps) {
  return (
    <Tag
      className={`rl-chip rl-chip--${state}${chrome ? " rl-chip--chrome" : ""} ${className}`.trim()}
      {...(Tag === "button" ? { type: "button" as const } : {})}
      {...props}
    >
      <Icon name={WORK_STATE_ICON[state]} size={chrome ? 14 : iconSize} />
      <span className="rl-num">{label}</span>
      {offline ? <Icon name="no-signal" size={iconSize} /> : null}
    </Tag>
  );
}

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: WorkState | "role";
  size?: "default" | "compact" | "mini";
  icon?: ReactNode;
  children: ReactNode;
}

/** Generic status chip (e.g. "Graded · 38/40", "Student", "2 pages updated"). */
export function Chip({
  tone = "role",
  size = "default",
  icon,
  className = "",
  children,
  ...props
}: ChipProps) {
  const sizeClass =
    size === "compact" ? " rl-chip--compact" : size === "mini" ? " rl-chip--mini" : "";
  return (
    <span className={`rl-chip rl-chip--${tone}${sizeClass} ${className}`.trim()} {...props}>
      {icon}
      <span className="rl-num">{children}</span>
    </span>
  );
}
