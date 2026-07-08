"use client";

/**
 * Shared bits for the REAL course surfaces (catalog → TOC → player →
 * downloads): chevron/back button, byte formatting, the data-saver
 * preference, and the offline-safe navigation handoffs. The old fixture
 * chapter/page constants are gone — content now comes from the stored
 * course manifest (lib/course).
 */

import Link from "next/link";
import { useCallback, useEffect, useState, type CSSProperties } from "react";

/* ---------- chevron (not in the @rl/ui icon set) ---------- */

export function Chevron({
  size = 18,
  dir = "left",
}: {
  size?: number;
  dir?: "left" | "right";
}) {
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
      {dir === "left" ? <path d="M14.5 5.5L8 12l6.5 6.5" /> : <path d="M9.5 5.5L16 12l-6.5 6.5" />}
    </svg>
  );
}

/** Circular back button — 44px minimum target, chevron-left. */
export function BackButton({
  href,
  label,
  size = 44,
  iconSize = 19,
}: {
  href: string;
  label: string;
  size?: number;
  iconSize?: number;
}) {
  const style: CSSProperties = {
    width: size,
    height: size,
    minWidth: size,
    borderRadius: "50%",
    background: "var(--color-card)",
    border: "1px solid var(--color-border)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--color-ink)",
    textDecoration: "none",
    flexShrink: 0,
  };
  return (
    <Link href={href} aria-label={label} style={style}>
      <Chevron size={iconSize} dir="left" />
    </Link>
  );
}

/* ---------- byte formatting (counts over adjectives) ---------- */

/** "0 KB" / "820 KB" / "1.2 MB" / "2.0 GB" — approximate, for download
    affordances and the storage legend. */
export function fmtBytes(bytes: number): string {
  if (bytes <= 0) return "0 KB";
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/* ---------- data saver — student default ON, a local preference ---------- */

const DATA_SAVER_KEY = "rl-data-saver";

export function useDataSaver(): [boolean, (value: boolean) => void] {
  const [on, setOn] = useState(true);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DATA_SAVER_KEY);
      if (raw !== null) setOn(raw === "1");
    } catch {
      /* first run / storage unavailable — default stays on */
    }
  }, []);
  const update = useCallback((value: boolean) => {
    setOn(value);
    try {
      localStorage.setItem(DATA_SAVER_KEY, value ? "1" : "0");
    } catch {
      /* preference lives for this tab only */
    }
  }, []);
  return [on, update];
}

/* ---------- offline-safe navigation handoffs ----------
   Course routes must stay query-string-free so the service worker's
   cached documents/RSC payloads keep answering offline (a `?p=` variant
   would be a fresh cache key). Targets ride sessionStorage instead. */

const READ_TARGET_KEY = "rl-read-target";
const EXAM_TARGET_KEY = "rl-exam-target";

export function setReadTarget(courseId: string, pageId: string): void {
  try {
    sessionStorage.setItem(READ_TARGET_KEY, `${courseId}:${pageId}`);
  } catch {
    /* the player falls back to the first unread page */
  }
}

/** Read-and-clear the handoff for this course (one-shot). */
export function takeReadTarget(courseId: string): string | null {
  try {
    const raw = sessionStorage.getItem(READ_TARGET_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(READ_TARGET_KEY);
    const [c, pageId] = raw.split(":");
    return c === courseId && pageId ? pageId : null;
  } catch {
    return null;
  }
}

export function setExamTarget(examId: string): void {
  try {
    sessionStorage.setItem(EXAM_TARGET_KEY, examId);
  } catch {
    /* the exams list still shows it */
  }
}

export function takeExamTarget(): string | null {
  try {
    const examId = sessionStorage.getItem(EXAM_TARGET_KEY);
    if (examId) sessionStorage.removeItem(EXAM_TARGET_KEY);
    return examId;
  } catch {
    return null;
  }
}
