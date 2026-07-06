import type { HTMLAttributes } from "react";
import { Icon } from "./icons";

export interface ScopeBreadcrumbProps extends HTMLAttributes<HTMLElement> {
  /** Ancestor scopes, outermost first. Mobile truncates from the left. */
  ancestors: string[];
  current: string;
  /** e.g. "Your scope — you can't see other districts" */
  note?: string;
  /** Render the leading "… ›" truncation instead of full ancestor chain. */
  truncated?: boolean;
}

/** Scope breadcrumb — always visible for admins; doubles as the
    lateral-isolation cue. The current scope is never cut. */
export function ScopeBreadcrumb({
  ancestors,
  current,
  note,
  truncated,
  className = "",
  ...props
}: ScopeBreadcrumbProps) {
  const shown = truncated ? ancestors.slice(-1) : ancestors;
  return (
    <nav className={`rl-breadcrumb ${className}`.trim()} aria-label="Scope" {...props}>
      {truncated ? <span className="rl-breadcrumb__sep" style={{ fontSize: 12 }}>… ›</span> : null}
      {shown.map((scope) => (
        <span key={scope} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          <span className="rl-breadcrumb__scope">{scope}</span>
          <span className="rl-breadcrumb__sep">›</span>
        </span>
      ))}
      <span className="rl-breadcrumb__current">{current}</span>
      {note ? (
        <span className="rl-breadcrumb__note">
          <Icon name="lock" size={12} />
          {note}
        </span>
      ) : null}
    </nav>
  );
}
