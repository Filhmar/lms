"use client";

/**
 * Shared bits for the course surfaces (catalog → TOC → player).
 * Local demo constants only — no network; content mirrors the design export
 * (Science 8 · Chapter 3: Weather disturbances).
 */

import Link from "next/link";
import type { CSSProperties } from "react";

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

/* ---------- Science 8 demo structure ---------- */

export type ChapterState = "done" | "current" | "pages-only" | "not-downloaded";

export interface Chapter {
  n: number;
  title: string;
  state: ChapterState;
  /** Trailing download affordance label parts, when something is missing. */
  download?: { label: string; size: string };
}

/** Chapters as designed in p3b (Course TOC) and d4e (player rail). */
export const science8Chapters: Chapter[] = [
  { n: 1, title: "Earthquakes and faults", state: "done" },
  { n: 2, title: "Typhoons", state: "done" },
  { n: 3, title: "Weather disturbances", state: "current" },
  {
    n: 4,
    title: "Interactions in ecosystems",
    state: "pages-only",
    download: { label: "Video", size: "24 MB" },
  },
  { n: 5, title: "Motion", state: "not-downloaded", download: { label: "Get", size: "6 MB" } },
];

export interface CoursePage {
  n: number;
  title: string;
  h1: string;
  body: string[];
}

/** Chapter 3 pages. Page 5 is the fully designed reading page (d4a/p3c);
 *  page 6 is the "not on this phone yet" page until prefetched (d4c). */
export const chapter3Pages: CoursePage[] = [
  {
    n: 1,
    title: "What is a tropical cyclone?",
    h1: "What is a tropical cyclone?",
    body: [
      "A tropical cyclone is a large rotating storm that forms over warm ocean water. In the Philippines we call the strongest ones bagyo.",
      "Every year, about twenty tropical cyclones enter the Philippine Area of Responsibility.",
    ],
  },
  {
    n: 2,
    title: "How typhoons form",
    h1: "How typhoons form",
    body: [
      "Warm, moist air rises from the sea surface and cooler air rushes in below it. As this cycle repeats, clouds spin into a huge rotating system.",
      "When winds near the center pass 118 km/h, the storm is called a typhoon.",
    ],
  },
  {
    n: 3,
    title: "Reading the weather map",
    h1: "Reading the weather map",
    body: [
      "Weather maps show where a storm is, where it is heading, and how wide its winds reach. The eye of the storm sits at the center of the spiral.",
      "PAGASA updates the storm track several times a day while a cyclone is inside the Philippine Area of Responsibility.",
    ],
  },
  {
    n: 4,
    title: "Rainfall and flooding",
    h1: "Rainfall and flooding",
    body: [
      "A slow-moving storm can drop more rain than a fast one, even when its winds are weaker. Low-lying communities watch rainfall warnings closely.",
      "Know where your barangay's evacuation center is before the rain starts.",
    ],
  },
  {
    n: 5,
    title: "Storm signals",
    h1: "Public storm warning signals",
    body: [
      "When a tropical cyclone approaches, PAGASA raises wind signals from 1 to 5. Each signal tells your community how strong winds may get — and how much time you have to prepare.",
    ],
  },
  {
    n: 6,
    title: "Community preparedness",
    h1: "Community preparedness",
    body: [
      "Signals matter most when the whole community acts on them together. Schools, barangay halls, and families each have a role before the wind arrives.",
      "Prepare a family plan: where to meet, what to bring, and who checks on elderly neighbors.",
    ],
  },
];

export const CH3_CRUMB = "Ch. 3 · Weather disturbances";
