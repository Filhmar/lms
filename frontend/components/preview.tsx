"use client";

/**
 * Preview gating for Phase II–IV surfaces (and the demo sections of the
 * student home). Wraps children with:
 *   · the demo-state provider (theme / connectivity / iOS / battery),
 *   · a fixed, always-visible "Preview — demo data" badge (amber on-device
 *     chip styling; shape + icon + label, never color alone),
 *   · the ⚙ DevHarness — which now exists ONLY on preview surfaces.
 * Real Phase I screens must never render inside this shell.
 */

import type { ReactNode } from "react";
import { Icon } from "@rl/ui";
import { DemoProvider } from "@/lib/demo";
import { DevHarness } from "@/components/dev-harness";

export function PreviewBadge() {
  return (
    <div
      style={{
        position: "fixed",
        top: 8,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 70,
        pointerEvents: "none",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: "var(--color-on-device-bg)",
          color: "var(--color-on-device-fg)",
          border: "1.5px dashed var(--color-on-device-solid)",
          borderRadius: 999,
          padding: "5px 12px",
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: "0.03em",
          whiteSpace: "nowrap",
          boxShadow: "0 2px 10px rgba(12,19,34,0.10)",
        }}
      >
        <Icon name="flag" size={11} aria-hidden />
        Preview — demo data
      </span>
    </div>
  );
}

export function PreviewShell({ children }: { children: ReactNode }) {
  return (
    <DemoProvider>
      <PreviewBadge />
      {children}
      <DevHarness />
    </DemoProvider>
  );
}
