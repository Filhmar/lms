"use client";

/**
 * Floating demo harness — replicates the prototype's "Tweaks" panel so
 * reviewers can flip theme / connectivity / iOS mode / battery states.
 * Dev/review chrome only; not part of the product UI.
 */

import { useState } from "react";
import { useDemo, type Connectivity } from "@/lib/demo";

const CONNECTIVITY: { value: Connectivity; label: string }[] = [
  { value: "online", label: "Online" },
  { value: "slow-2g", label: "Slow 2G" },
  { value: "offline", label: "Offline" },
];

export function DevHarness() {
  const demo = useDemo();
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: "fixed", right: 12, bottom: 76, zIndex: 60 }}>
      {open ? (
        <div
          className="rl-card"
          style={{ padding: 12, marginBottom: 8, width: 210, boxShadow: "0 8px 24px rgba(12,19,34,0.18)" }}
        >
          <div className="rl-overline" style={{ marginBottom: 8 }}>
            Demo harness
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {CONNECTIVITY.map((c) => (
              <button
                key={c.value}
                type="button"
                className="rl-chip"
                style={{
                  cursor: "pointer",
                  border: "none",
                  fontFamily: "inherit",
                  background:
                    demo.connectivity === c.value ? "var(--color-primary)" : "var(--color-primary-tint)",
                  color: demo.connectivity === c.value ? "#fff" : "var(--color-primary)",
                }}
                onClick={() => demo.set("connectivity", c.value)}
              >
                {c.label}
              </button>
            ))}
          </div>
          {(
            [
              ["Dark theme", demo.theme === "dark", () => demo.set("theme", demo.theme === "dark" ? "light" : "dark")],
              ["iOS mode", demo.iosMode, () => demo.set("iosMode", !demo.iosMode)],
              ["Battery low", demo.batteryLow, () => demo.set("batteryLow", !demo.batteryLow)],
            ] as const
          ).map(([label, on, toggle]) => (
            <label
              key={label}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 0", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
            >
              {label}
              <input type="checkbox" checked={on} onChange={toggle} />
            </label>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Demo harness"
        style={{
          width: 44,
          height: 44,
          borderRadius: "50%",
          border: "1.5px solid var(--color-border)",
          background: "var(--color-card)",
          color: "var(--color-ink)",
          fontSize: 16,
          cursor: "pointer",
          boxShadow: "0 4px 14px rgba(12,19,34,0.15)",
        }}
      >
        ⚙
      </button>
    </div>
  );
}
