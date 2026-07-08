"use client";

/**
 * Wallet state layer — the credentials surfaces' REAL data source.
 *
 *  · GET /credentials (list) and GET /credentials/:id (detail) with an
 *    offline cache in localStorage (`rl-wallet-cache`) — credentials are a
 *    small JSON payload, and the wallet must render with zero signal (the
 *    design's "saved on this phone" promise). The cache is per-holder: it is
 *    keyed by user id and dropped when a different account signs in.
 *  · Pending claims: locally submitted/graded exam attempts (from the exam
 *    engine) whose badge hasn't shown up in the wallet list yet render as the
 *    dashed "Official after next send" tiles — earned here, paperwork still
 *    travelling. Never "unverified".
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { CredentialDetail, CredentialListItem } from "@rl/schemas";
import { ApiError, apiGet } from "@/lib/api";
import type { EngineState } from "@/lib/exam/engine";

/* ------------------------------ offline cache ----------------------------- */

const CACHE_KEY = "rl-wallet-cache";

interface WalletCache {
  /** Holder the cache belongs to — never show another account's wallet. */
  userId: string;
  items: CredentialListItem[];
  /** Details seen this device, by credential id (incl. verifyUrl + vc). */
  details: Record<string, CredentialDetail>;
  cachedAt: string;
}

function readCache(userId: string): WalletCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WalletCache;
    if (parsed?.userId !== userId || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(cache: WalletCache): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* storage unavailable — the wallet will need the network next time */
  }
}

function cacheItems(userId: string, items: CredentialListItem[]): void {
  const prev = readCache(userId);
  const details: Record<string, CredentialDetail> = {};
  if (prev) {
    // Keep only details whose credential still exists.
    for (const item of items) {
      if (prev.details[item.id]) details[item.id] = prev.details[item.id]!;
    }
  }
  writeCache({ userId, items, details, cachedAt: new Date().toISOString() });
}

function cacheDetail(userId: string, detail: CredentialDetail): void {
  const prev = readCache(userId);
  const base: WalletCache = prev ?? {
    userId,
    items: [],
    details: {},
    cachedAt: new Date().toISOString(),
  };
  // The list entry follows the detail (status flips show offline too).
  const listItem: CredentialListItem = {
    id: detail.id,
    kind: detail.kind,
    title: detail.title,
    monogram: detail.monogram,
    status: detail.status,
    controlNo: detail.controlNo,
    verifyCode: detail.verifyCode,
    issuedAt: detail.issuedAt,
    issuerLine: detail.issuerLine,
  };
  const items = base.items.some((i) => i.id === detail.id)
    ? base.items.map((i) => (i.id === detail.id ? listItem : i))
    : [...base.items, listItem];
  writeCache({
    userId,
    items,
    details: { ...base.details, [detail.id]: detail },
    cachedAt: new Date().toISOString(),
  });
}

/* ------------------------------- list hook -------------------------------- */

export interface WalletState {
  /** false until the cache has been consulted (first paint stays calm). */
  ready: boolean;
  /** true once GET /credentials answered this mount; false = cached copy. */
  live: boolean;
  items: CredentialListItem[];
}

/** The caller's wallet: live list when reachable, cached copy otherwise. */
export function useWallet(userId: string | undefined): WalletState {
  const [state, setState] = useState<WalletState>({
    ready: false,
    live: false,
    items: [],
  });

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    const cached = readCache(userId);
    setState({ ready: true, live: false, items: cached?.items ?? [] });

    const load = async () => {
      try {
        const items = await apiGet<CredentialListItem[]>("/credentials");
        if (cancelled) return;
        cacheItems(userId, items);
        setState({ ready: true, live: true, items });
      } catch {
        /* offline / unreachable — the cached copy stays up */
      }
    };
    void load();
    const onOnline = () => void load();
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
    };
  }, [userId]);

  return state;
}

/* ------------------------------ detail hook ------------------------------- */

export interface CredentialDetailState {
  ready: boolean;
  /** true once GET /credentials/:id answered this mount. */
  live: boolean;
  detail: CredentialDetail | null;
  /** The service explicitly said this id doesn't exist for this account. */
  notFound: boolean;
}

export function useCredentialDetail(
  userId: string | undefined,
  id: string | null,
): CredentialDetailState {
  const [state, setState] = useState<CredentialDetailState>({
    ready: false,
    live: false,
    detail: null,
    notFound: false,
  });

  useEffect(() => {
    if (!userId || !id) return;
    let cancelled = false;

    const cached = readCache(userId)?.details[id] ?? null;
    setState({ ready: true, live: false, detail: cached, notFound: false });

    const load = async () => {
      try {
        const detail = await apiGet<CredentialDetail>(`/credentials/${id}`);
        if (cancelled) return;
        cacheDetail(userId, detail);
        setState({ ready: true, live: true, detail, notFound: false });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setState({ ready: true, live: true, detail: null, notFound: true });
        }
        /* network trouble — the cached detail (if any) stays up */
      }
    };
    void load();
    const onOnline = () => void load();
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
    };
  }, [userId, id]);

  return state;
}

/* ----------------------------- pending claims ----------------------------- */

/** Route prefix for a claim that has no credential id yet. */
export const PENDING_PREFIX = "pending-";

export interface PendingClaim {
  /** Wallet route id: `pending-<examId>`. */
  id: string;
  examId: string;
  title: string;
  monogram: string;
}

/** Medallion monogram — same derivation the issuance path uses:
    "Science 8 · Quarter 2 Periodical" → "S8", "Grade 7 Completion" → "G7". */
export function deriveMonogram(title: string): string {
  const initial = (title.match(/[A-Za-z]/)?.[0] ?? "").toUpperCase();
  const digits = title.match(/\d+/)?.[0] ?? "";
  return `${initial}${digits.slice(0, 2)}` || "RL";
}

/**
 * Submitted/locally-graded attempts whose badge credential hasn't arrived in
 * the wallet yet. Matching is by title — an issued exam badge carries the
 * exam's title verbatim.
 */
export function derivePendingClaims(
  eng: EngineState,
  items: CredentialListItem[],
): PendingClaim[] {
  const ownedTitles = new Set(
    items.filter((c) => c.kind === "badge").map((c) => c.title),
  );
  const claims: PendingClaim[] = [];
  for (const attempt of Object.values(eng.attempts)) {
    if (attempt.state !== "submitted") continue;
    const title =
      eng.packages[attempt.examId]?.title ??
      eng.exams.find((e) => e.id === attempt.examId)?.title;
    if (!title || ownedTitles.has(title)) continue;
    claims.push({
      id: `${PENDING_PREFIX}${attempt.examId}`,
      examId: attempt.examId,
      title,
      monogram: deriveMonogram(title),
    });
  }
  return claims.sort((a, b) => a.title.localeCompare(b.title));
}

/* ------------------------------ small helpers ----------------------------- */

/** "Mar 28, 2026" — issue dates on wallet surfaces. */
export function fmtIssuedDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Quiet celebration when a pending claim flips official: remembers which
 * titles were pending and reports the first one that shows up as an official
 * badge in a later render. Returns null until that moment.
 */
export function useClaimConfirmedToast(
  pending: PendingClaim[],
  items: CredentialListItem[],
  ready: boolean,
): string | null {
  const seenPending = useRef<Set<string>>(new Set());
  const [confirmedTitle, setConfirmedTitle] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!ready) return;
    const official = new Set(
      items.filter((c) => c.kind === "badge" && c.status === "active").map((c) => c.title),
    );
    for (const title of seenPending.current) {
      if (official.has(title)) {
        seenPending.current.delete(title);
        setConfirmedTitle(title);
        setVisible(true);
        break;
      }
    }
    for (const claim of pending) seenPending.current.add(claim.title);
  }, [pending, items, ready]);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => setVisible(false), 4200);
    return () => clearTimeout(timer);
  }, [visible]);

  return visible ? confirmedTitle : null;
}
