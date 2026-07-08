/**
 * Outbox drainer — the drip-sync half of the offline-first pattern.
 *
 * TECHSTACK §3 correction honored here: the Background Sync API is a
 * Chromium-only ENHANCEMENT (it does not exist on iOS Safari). The REAL
 * triggers are app-level:
 *   · ~30s interval while an exam surface is mounted,
 *   · the window 'online' event,
 *   · visibilitychange → visible.
 * Where 'SyncManager' exists we additionally register a sync tag; the SW
 * answers it by nudging open clients to drain (no-op elsewhere).
 *
 * Batches are ≤50 events per POST /sync/batch. merged/stale/duplicate all
 * mean "the school has it" → mark sent; rejected events are kept and
 * surfaced as needing attention. Transport failures back off 30s → 2m → 10m.
 */

import { apiPost } from "@/lib/api";
import type { SyncBatchResponse } from "@rl/schemas";
import {
  bumpOutboxTries,
  getOutbox,
  markOutbox,
  type OutboxMark,
} from "./db";

const BATCH_MAX = 50;
const BACKOFF_MS = [30_000, 120_000, 600_000] as const;
export const SYNC_TAG = "rl-outbox";

/* ------------------------------ change signal ---------------------------- */

type Listener = () => void;
const listeners = new Set<Listener>();

/** Fired after every drain pass that changed (or tried to change) the outbox. */
export function subscribeOutbox(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyOutboxChanged(): void {
  for (const listener of listeners) listener();
}

/* --------------------------------- drain --------------------------------- */

let draining: Promise<void> | null = null;
let failStreak = 0;
let backoffUntil = 0;

/**
 * Send pending events to school. Single-flight; respects the retry backoff
 * unless `force` (Send now, 'online', post-submit) is set. Resolves once the
 * pass completes — outcomes land in IndexedDB and subscribers are notified.
 */
export function drainOutbox(force = false): Promise<void> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return Promise.resolve();
  }
  if (!force && Date.now() < backoffUntil) return Promise.resolve();
  draining ??= doDrain().finally(() => {
    draining = null;
  });
  return draining;
}

async function doDrain(): Promise<void> {
  for (;;) {
    const pending = (await getOutbox())
      .filter((r) => r.status === "pending")
      .slice(0, BATCH_MAX);
    if (pending.length === 0) return;

    let res: SyncBatchResponse;
    try {
      res = await apiPost<SyncBatchResponse>("/sync/batch", {
        events: pending.map((r) => r.event),
      });
    } catch {
      // Transport-level failure — everything stays safely pending.
      failStreak = Math.min(failStreak + 1, BACKOFF_MS.length);
      backoffUntil = Date.now() + BACKOFF_MS[failStreak - 1]!;
      await bumpOutboxTries(pending.map((r) => r.id!));
      notifyOutboxChanged();
      return;
    }

    failStreak = 0;
    backoffUntil = 0;
    const outcomes = new Map(res.results.map((r) => [r.id, r]));
    const now = Date.now();
    const marks: OutboxMark[] = [];
    for (const record of pending) {
      const outcome = outcomes.get(record.event.id);
      if (!outcome) continue; // no echo — stays pending for the next pass
      if (outcome.outcome === "rejected") {
        marks.push({
          id: record.id!,
          status: "rejected",
          sentAtMs: null,
          reason: outcome.reason,
        });
      } else {
        // merged | stale | duplicate — the school has it either way.
        marks.push({ id: record.id!, status: "sent", sentAtMs: now });
      }
    }
    await markOutbox(marks);
    notifyOutboxChanged();
    if (pending.length < BATCH_MAX) return; // nothing more was waiting
  }
}

/* -------------------------------- triggers ------------------------------- */

let triggerRefs = 0;
let detachTriggers: (() => void) | null = null;

/**
 * Ref-counted app-level triggers — call from every mounted exam surface;
 * the returned cleanup releases them.
 */
export function attachOutboxTriggers(): () => void {
  triggerRefs += 1;
  if (triggerRefs === 1) detachTriggers = startTriggers();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    triggerRefs -= 1;
    if (triggerRefs === 0) {
      detachTriggers?.();
      detachTriggers = null;
    }
  };
}

function startTriggers(): () => void {
  const onOnline = () => {
    void drainOutbox(true);
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") void drainOutbox();
  };
  const onSwMessage = (event: MessageEvent) => {
    if ((event.data as { type?: string } | null)?.type === "RL_OUTBOX_SYNC") {
      void drainOutbox(true);
    }
  };
  const interval = setInterval(() => {
    void drainOutbox();
  }, 30_000);
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  navigator.serviceWorker?.addEventListener("message", onSwMessage);
  void registerBackgroundSync();
  return () => {
    clearInterval(interval);
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
    navigator.serviceWorker?.removeEventListener("message", onSwMessage);
  };
}

/** Chromium-only enhancement — silently a no-op everywhere else. */
async function registerBackgroundSync(): Promise<void> {
  try {
    if (!("SyncManager" in window) || !("serviceWorker" in navigator)) return;
    const registration = await navigator.serviceWorker.ready;
    const sync = (
      registration as unknown as {
        sync?: { register(tag: string): Promise<void> };
      }
    ).sync;
    await sync?.register(SYNC_TAG);
  } catch {
    /* enhancement only — app-level triggers carry the load */
  }
}
