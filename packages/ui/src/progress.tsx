import type { HTMLAttributes } from "react";

export interface BarProps extends HTMLAttributes<HTMLDivElement> {
  /** 0–100 */
  percent: number;
  paused?: boolean;
}

export function Bar({ percent, paused, className = "", ...props }: BarProps) {
  return (
    <div
      className={`rl-bar${paused ? " rl-bar--paused" : ""} ${className}`.trim()}
      role="progressbar"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      {...props}
    >
      <div className="rl-bar__fill" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </div>
  );
}

export interface StorageSegment {
  /** 0–100 share of the whole bar */
  percent: number;
  color: string;
  label: string;
}

export function StorageBar({
  segments,
  ...props
}: HTMLAttributes<HTMLDivElement> & { segments: StorageSegment[] }) {
  return (
    <div className="rl-storage-bar" {...props}>
      {segments.map((s) => (
        <div key={s.label} style={{ width: `${s.percent}%`, background: s.color }} />
      ))}
    </div>
  );
}
