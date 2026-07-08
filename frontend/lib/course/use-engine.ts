"use client";

/**
 * React adapter for the course engine — the only file in lib/course that
 * touches React (the pure-TS modules graduate to packages/* for the RN
 * port; this adapter stays with the web app).
 */

import { useEffect, useSyncExternalStore } from "react";
import { attachOutboxTriggers } from "@/lib/exam/outbox";
import {
  getCourseEngineState,
  getServerCourseEngineState,
  initCourseEngine,
  subscribeCourseEngine,
  type CourseEngineState,
} from "./engine";

/**
 * Subscribe to the engine and, while mounted, keep the SHARED outbox
 * triggers (30s drip interval / 'online' / visibility) attached — reading
 * progress drips out through the same pipeline as exam answers.
 */
export function useCourseEngine(): CourseEngineState {
  const state = useSyncExternalStore(
    subscribeCourseEngine,
    getCourseEngineState,
    getServerCourseEngineState,
  );
  useEffect(() => {
    void initCourseEngine();
    return attachOutboxTriggers();
  }, []);
  return state;
}
