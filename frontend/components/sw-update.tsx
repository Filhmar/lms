"use client";

/**
 * Update banner — shows when a new service worker is waiting. The learner
 * decides when to switch ("Refresh now" posts SKIP_WAITING, then reloads once
 * the new worker takes control; app/sw.ts registers with skipWaiting: false).
 * Never rendered mid-exam: an update must not disturb a running attempt.
 */

import { useSerwist } from "@serwist/turbopack/react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Banner } from "@rl/ui";
import { environment } from "@/lib/copy";

export function SwUpdate() {
  const { serwist } = useSerwist();
  const pathname = usePathname();
  const [updateReady, setUpdateReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const refreshing = useRef(false);

  useEffect(() => {
    if (!serwist) return;
    const onWaiting = () => setUpdateReady(true);
    serwist.addEventListener("waiting", onWaiting);
    return () => serwist.removeEventListener("waiting", onWaiting);
  }, [serwist]);

  // Never interrupt an exam — the banner reappears on the next screen.
  if (!updateReady || dismissed || pathname?.startsWith("/exams")) return null;

  const refreshNow = () => {
    if (!serwist || refreshing.current) return;
    refreshing.current = true;
    serwist.addEventListener("controlling", () => {
      window.location.reload();
    });
    serwist.messageSkipWaiting();
  };

  const actionButton: React.CSSProperties = {
    background: "none",
    border: 0,
    padding: "2px 4px",
    font: "inherit",
    fontSize: 12.5,
  };

  return (
    <div
      role="status"
      style={{
        position: "fixed",
        left: 12,
        right: 12,
        bottom: 12,
        zIndex: 60,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <Banner
        tone="info"
        icon="download"
        style={{
          width: "100%",
          maxWidth: 420,
          alignItems: "center",
          background: "var(--color-card)",
          boxShadow: "0 6px 24px rgba(12, 19, 34, 0.14)",
          pointerEvents: "auto",
        }}
        action={
          <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button type="button" className="rl-banner__action" style={actionButton} onClick={refreshNow}>
              Refresh now
            </button>
            <button
              type="button"
              className="rl-banner__action rl-banner__action--quiet"
              style={actionButton}
              onClick={() => setDismissed(true)}
            >
              Later
            </button>
          </span>
        }
      >
        <strong>{environment.updateReady}</strong>
      </Banner>
    </div>
  );
}
