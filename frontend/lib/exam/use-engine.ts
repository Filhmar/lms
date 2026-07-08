"use client";

/**
 * React adapter for the exam engine — the only file in lib/exam that touches
 * React (the pure-TS modules graduate to packages/* for the RN port; this
 * adapter stays with the web app).
 */

import { useEffect, useSyncExternalStore } from "react";
import {
  getEngineState,
  getServerEngineState,
  initEngine,
  subscribeEngine,
  type EngineState,
} from "./engine";
import { attachOutboxTriggers } from "./outbox";

/**
 * Subscribe to the engine and, while mounted, keep the outbox triggers
 * (30s drip interval / 'online' / visibility) attached.
 */
export function useExamEngine(): EngineState {
  const state = useSyncExternalStore(
    subscribeEngine,
    getEngineState,
    getServerEngineState,
  );
  useEffect(() => {
    void initEngine();
    return attachOutboxTriggers();
  }, []);
  return state;
}
