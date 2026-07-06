"use client";

/**
 * Sync Center — standalone route. Same content as the exam journey's
 * Sync Center sheet, reading (and writing back) the same persisted demo
 * snapshot, with the 350ms process tick so drips resolve live here too.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SyncPill, Toast, type WorkState } from "@rl/ui";
import * as copy from "@/lib/copy";
import { useDemo } from "@/lib/demo";
import { SyncCenterContent } from "../exams/sync-center";
import {
  advanceTick,
  EXTRAS_TOTAL,
  loadState,
  pendingAll,
  serialize,
  STORAGE_KEY,
  strings,
  TOTAL,
  type ExamSnapshot,
} from "../exams/state";

function ChevronLeft({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14.5 5.5L8 12l6.5 6.5" />
    </svg>
  );
}

export default function SyncPage() {
  const { connectivity } = useDemo();
  const [s, setS] = useState<ExamSnapshot | null>(null);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* restore the shared snapshot on mount */
  useEffect(() => {
    setS(loadState());
  }, []);

  /* persist on change (deduped) */
  const lastSnap = useRef("");
  useEffect(() => {
    if (!s) return;
    const snap = serialize(s);
    if (snap === lastSnap.current) return;
    lastSnap.current = snap;
    try {
      localStorage.setItem(STORAGE_KEY, snap);
    } catch {
      /* storage unavailable */
    }
  }, [s]);

  /* 350ms process tick — drip send / extras / grading continue here */
  const tickRef = useRef(0);
  useEffect(() => {
    if (!s) return;
    const id = setInterval(() => {
      tickRef.current += 1;
      const tick = tickRef.current;
      setS((p) => (p ? advanceTick(p, connectivity, tick) : p));
    }, 350);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s === null, connectivity]);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  if (!s) return null;

  const offline = connectivity === "offline";
  const pendAll = pendingAll(s);
  const pillState: WorkState = pendAll === 0 ? "synced" : !offline ? "sending" : "on-device";
  const pillLabel =
    pillState === "synced"
      ? copy.syncCenter.pillAllSent
      : pillState === "sending"
        ? strings.sendingLeft(pendAll)
        : copy.syncCenter.pillResting(pendAll);

  const sendNow = () => {
    if (offline) return;
    setS((p) =>
      p
        ? {
            ...p,
            sent: p.submitted ? TOTAL : p.sent,
            extraSent: EXTRAS_TOTAL,
            lastSync: "just now",
          }
        : p,
    );
    setToast(strings.toastAllSent);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 1600);
  };

  return (
    <div
      style={{
        minHeight: "100dvh",
        maxWidth: 480,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px 10px" }}>
        <Link
          href="/exams"
          aria-label="Back to exams"
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            background: "var(--color-card)",
            border: "1px solid var(--color-border)",
            color: "var(--color-ink)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <ChevronLeft size={20} />
        </Link>
        <h1 style={{ flex: 1, fontSize: 19, fontWeight: 800, margin: 0 }}>Sync Center</h1>
        <SyncPill chrome state={pillState} label={pillLabel} offline={offline} />
      </div>

      <div style={{ padding: "4px 16px 20px" }}>
        <div
          style={{
            background: "var(--color-card)",
            border: "1.5px solid var(--color-border)",
            borderRadius: 14,
            padding: 15,
          }}
        >
          <SyncCenterContent s={s} connectivity={connectivity} onSendNow={sendNow} showTitle={false} />
        </div>
      </div>

      {toast ? (
        <div
          style={{
            position: "fixed",
            top: 14,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
            zIndex: 80,
            pointerEvents: "none",
          }}
        >
          <Toast style={{ background: "#17233F", color: "#fff", boxShadow: "0 4px 14px rgba(12,19,34,0.3)" }}>
            {toast}
          </Toast>
        </div>
      ) : null}
    </div>
  );
}
