import type { HTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./icons";

/** Transient confirm toast — e.g. "Saved on this phone". */
export function Toast({
  children,
  icon = "check",
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement> & { icon?: IconName }) {
  return (
    <div className={`rl-toast ${className}`.trim()} role="status" {...props}>
      <span style={{ color: "var(--color-toast-accent)", display: "inline-flex" }}>
        <Icon name={icon} size={14} strokeWidth={2.8} />
      </span>
      {children}
    </div>
  );
}

export interface BannerProps extends HTMLAttributes<HTMLDivElement> {
  tone?: "default" | "info" | "warning";
  icon?: IconName;
  iconColor?: string;
  action?: ReactNode;
  children: ReactNode;
}

/** Inline banner — merge notice, iOS keep-open, update-ready, storage. */
export function Banner({
  tone = "default",
  icon,
  iconColor,
  action,
  className = "",
  children,
  ...props
}: BannerProps) {
  const toneClass =
    tone === "info" ? " rl-banner--info" : tone === "warning" ? " rl-banner--warning" : "";
  return (
    <div className={`rl-banner${toneClass} ${className}`.trim()} {...props}>
      {icon ? (
        <span style={{ color: iconColor ?? "var(--color-primary)", display: "inline-flex", flexShrink: 0, marginTop: 1 }}>
          <Icon name={icon} size={17} />
        </span>
      ) : null}
      <div style={{ flex: 1 }}>{children}</div>
      {action}
    </div>
  );
}
