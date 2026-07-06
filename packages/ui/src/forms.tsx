"use client";

import type { InputHTMLAttributes, ReactNode } from "react";
import { useId } from "react";
import { Icon } from "./icons";

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Actionable helper copy, e.g. "Check the email — it has two @ signs." */
  error?: string;
}

export function Field({ label, error, className = "", ...props }: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div>
      <label className="rl-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={`rl-input${error ? " rl-input--error" : ""} ${className}`.trim()}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...props}
      />
      {error ? (
        <div className="rl-input-error" id={errorId}>
          <Icon name="attention" size={12} />
          {error}
        </div>
      ) : null}
    </div>
  );
}

export interface ToggleRowProps {
  title: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  trailing?: ReactNode;
}

export function ToggleRow({ title, description, checked, onChange }: ToggleRowProps) {
  return (
    <div className="rl-toggle-row">
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
        {description ? (
          <div style={{ fontSize: 12, color: "var(--color-ink-subtle)" }}>{description}</div>
        ) : null}
      </div>
      <Switch checked={checked} onChange={onChange} label={title} />
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="rl-switch"
      onClick={() => onChange(!checked)}
    >
      <span className="rl-switch__knob" />
    </button>
  );
}
