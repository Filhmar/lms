import type { HTMLAttributes } from "react";
import { Icon } from "./icons";
import { Chip } from "./chips";

export interface CredentialBadgeProps extends HTMLAttributes<HTMLDivElement> {
  /** Medallion monogram, e.g. "S8" */
  monogram: string;
  name: string;
  /** Dashed ring = earned here, awaiting school confirmation. Copy never
      says "unverified" — the badge is earned, only the paperwork travels. */
  pending?: boolean;
}

export function CredentialBadge({
  monogram,
  name,
  pending,
  className = "",
  ...props
}: CredentialBadgeProps) {
  return (
    <div
      className={`rl-badge-card${pending ? " rl-badge-card--pending" : ""} ${className}`.trim()}
      {...props}
    >
      <div className={`rl-medallion${pending ? " rl-medallion--pending" : ""}`}>{monogram}</div>
      <div style={{ fontSize: 13.5, fontWeight: 700, marginTop: 9 }}>{name}</div>
      <div style={{ marginTop: 7 }}>
        {pending ? (
          <Chip tone="on-device" size="mini" icon={<Icon name="phone-check" size={11} />}>
            Official after next send
          </Chip>
        ) : (
          <Chip tone="synced" size="mini" icon={<Icon name="check" size={12} strokeWidth={2.6} />}>
            Official
          </Chip>
        )}
      </div>
    </div>
  );
}
