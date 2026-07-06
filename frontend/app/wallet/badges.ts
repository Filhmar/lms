"use client";

/**
 * Wallet demo data + the d9b claim lifecycle (pending → official).
 *
 * d9 notes (verbatim): the badge claim sends in the same batch as progress;
 * confirmation flips the ring solid with a quiet toast. Offline it simply
 * stays "Official after next send" — never "unverified".
 */

import { useEffect, useState } from "react";
import { useOnline } from "@/lib/demo";

export type BadgeStatus = "official" | "pending" | "revoked";

export interface BadgeRecord {
  id: string;
  monogram: string;
  name: string;
  /** Award line on the badge detail card, under "Awarded to …". */
  citation: string;
  status: BadgeStatus;
}

export const BADGES: BadgeRecord[] = [
  {
    id: "science-star",
    monogram: "S8",
    name: "Science Star",
    citation: "Quarter 1 top performance · Science 8",
    status: "official",
  },
  {
    id: "math-finisher",
    monogram: "M8",
    name: "Math Finisher",
    citation: "Completed all chapters · Math 8",
    status: "pending",
  },
  {
    id: "science-star-q3",
    monogram: "S7",
    name: "Science Star (Q3)",
    citation: "Quarter 3 top performance · Science 7",
    status: "revoked",
  },
];

export const PENDING_BADGE_NAME = "Math Finisher";

/**
 * Demo gating: while offline the claim rests on the phone; shortly after the
 * demo harness goes online the school "confirms" it — the dashed ring flips
 * solid and the quiet d9b toast shows. Going offline again re-arms the demo.
 */
export function useClaimConfirmation(sendDelayMs = 2400, toastMs = 4200) {
  const online = useOnline();
  const [confirmed, setConfirmed] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);

  useEffect(() => {
    if (!online) {
      setConfirmed(false);
      setToastVisible(false);
      return;
    }
    const timer = setTimeout(() => {
      setConfirmed(true);
      setToastVisible(true);
    }, sendDelayMs);
    return () => clearTimeout(timer);
  }, [online, sendDelayMs]);

  useEffect(() => {
    if (!toastVisible) return;
    const timer = setTimeout(() => setToastVisible(false), toastMs);
    return () => clearTimeout(timer);
  }, [toastVisible, toastMs]);

  return { confirmed, toastVisible };
}
