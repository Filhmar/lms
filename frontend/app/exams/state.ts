/**
 * Exam journey state machine + persistence (prototype-faithful).
 * localStorage stands in for the production IndexedDB repository + outbox
 * (see docs/plan.md); every mutation snapshots the full state under
 * `resilient-learn-exam-demo`, and a restore that lands on `taking`
 * enters `recovery` instead — that is the crash-recovery trigger.
 */

import type { Connectivity } from "@/lib/demo";
import { exam, examQuestions, outboxExtras } from "@/lib/fixtures";

export const STORAGE_KEY = "resilient-learn-exam-demo";
export const TOTAL = examQuestions.length; // 12
export const EXTRAS_TOTAL = outboxExtras.length; // 2
export const DURATION = exam.durationSeconds; // 1800 (30:00)

export type Stage =
  | "list"
  | "detail"
  | "taking"
  | "review"
  | "submitted"
  | "status"
  | "recovery";
export type DlState = "none" | "downloading" | "ready";
export type Answer = number | string | null;

export interface ExamSnapshot {
  stage: Stage;
  dlState: DlState;
  dlPct: number;
  answers: Answer[];
  flags: boolean[];
  cur: number;
  timer: number; // seconds remaining
  submitted: boolean;
  submitTime: string; // 'h:mm AM|PM' captured at submit
  sent: number; // exam answers delivered, 0..TOTAL
  extraSent: number; // other outbox items delivered, 0..EXTRAS_TOTAL
  graded: boolean;
  gradeTicks: number; // ticks since fully sent; grading at >= 14
  remindSet: boolean; // iOS "remind me" chosen
  lastSync: string;
}

export function freshState(): ExamSnapshot {
  return {
    stage: "list",
    dlState: "none",
    dlPct: 0,
    answers: Array<Answer>(TOTAL).fill(null),
    flags: Array<boolean>(TOTAL).fill(false),
    cur: 0,
    timer: DURATION,
    submitted: false,
    submitTime: "",
    sent: 0,
    extraSent: 0,
    graded: false,
    gradeTicks: 0,
    remindSet: false,
    lastSync: "today, 2:10 PM",
  };
}

const STAGES: readonly string[] = [
  "list",
  "detail",
  "taking",
  "review",
  "submitted",
  "status",
  "recovery",
];
const DL_STATES: readonly string[] = ["none", "downloading", "ready"];

/** Persisted fields only; `recovery` is stored as `taking` (spec §5.2). */
export function serialize(s: ExamSnapshot): string {
  return JSON.stringify({
    stage: s.stage === "recovery" ? "taking" : s.stage,
    dlState: s.dlState,
    dlPct: s.dlPct,
    answers: s.answers,
    flags: s.flags,
    cur: s.cur,
    timer: s.timer,
    submitted: s.submitted,
    submitTime: s.submitTime,
    sent: s.sent,
    extraSent: s.extraSent,
    graded: s.graded,
    gradeTicks: s.gradeTicks,
    remindSet: s.remindSet,
    lastSync: s.lastSync,
  });
}

/**
 * Restore: merge stored snapshot over fresh state, sanitize, and — if the
 * stored stage is `taking` — enter `recovery` (crash recovery on reload).
 * Parse failure → fresh start.
 */
export function loadState(): ExamSnapshot {
  const fresh = freshState();
  if (typeof window === "undefined") return fresh;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fresh;
    const p = JSON.parse(raw) as Partial<ExamSnapshot>;
    const merged: ExamSnapshot = { ...fresh, ...p };
    if (!STAGES.includes(merged.stage)) merged.stage = "list";
    if (!DL_STATES.includes(merged.dlState)) merged.dlState = "none";
    merged.answers = Array.from({ length: TOTAL }, (_, i) => {
      const a = Array.isArray(p.answers) ? p.answers[i] : null;
      return typeof a === "number" || typeof a === "string" ? a : null;
    });
    merged.flags = Array.from(
      { length: TOTAL },
      (_, i) => Array.isArray(p.flags) && p.flags[i] === true,
    );
    merged.cur = Math.min(Math.max(0, Math.floor(Number(merged.cur) || 0)), TOTAL - 1);
    merged.timer = Math.max(0, Math.floor(Number(merged.timer) || 0));
    if (merged.stage === "recovery") merged.stage = "taking";
    if (merged.stage === "taking") merged.stage = "recovery";
    return merged;
  } catch {
    return fresh;
  }
}

/* ---------- derived values (spec §5.1) ---------- */

export function answeredCount(answers: Answer[]): number {
  return answers.filter((a) => a !== null && a !== "").length;
}

export function pendingExam(s: ExamSnapshot): number {
  return s.submitted ? TOTAL - s.sent : 0;
}

export function pendingAll(s: ExamSnapshot): number {
  return pendingExam(s) + (EXTRAS_TOTAL - s.extraSent);
}

export function inProgress(s: ExamSnapshot): boolean {
  return !s.submitted && s.answers.some((a) => a !== null && a !== "");
}

/* ---------- formatting ---------- */

/** m:ss — minutes unpadded ("30:00", "1:05"), render with tabular numerals. */
export function fmtClock(totalSeconds: number): string {
  const sec = Math.max(0, totalSeconds);
  const m = Math.floor(sec / 60);
  const ss = String(sec % 60).padStart(2, "0");
  return `${m}:${ss}`;
}

/** 'h:mm AM|PM' — the submit timestamp. */
export function nowTime(): string {
  return new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/* ---------- the 350ms process tick (spec §5.3) ---------- */

/**
 * One process tick: download progress (8%/2%/stall), post-submit answer
 * drip (every tick online / every 5th slow-2g / never offline), extras
 * (online only, every 7th tick), grading countdown (14 ticks once fully
 * sent). Returns the SAME object when nothing changed so React can bail.
 */
export function advanceTick(
  s: ExamSnapshot,
  connectivity: Connectivity,
  tick: number,
): ExamSnapshot {
  const out = { ...s };
  let changed = false;

  if (out.dlState === "downloading") {
    const inc = connectivity === "online" ? 8 : connectivity === "slow-2g" ? 2 : 0;
    if (inc > 0) {
      out.dlPct = Math.min(100, out.dlPct + inc);
      if (out.dlPct >= 100) out.dlState = "ready";
      changed = true;
    }
  }

  if (out.submitted && out.sent < TOTAL && connectivity !== "offline") {
    if (connectivity === "online" || tick % 5 === 0) {
      out.sent += 1;
      out.lastSync = "just now";
      changed = true;
    }
  }

  if (out.extraSent < EXTRAS_TOTAL && connectivity === "online" && tick % 7 === 0) {
    out.extraSent += 1;
    out.lastSync = "just now";
    changed = true;
  }

  if (out.submitted && out.sent >= TOTAL && !out.graded) {
    out.gradeTicks += 1;
    if (out.gradeTicks >= 14) out.graded = true;
    changed = true;
  }

  return changed ? out : s;
}

/* ---------- journey strings not in the shared copy module ----------
   Verbatim from the exam-journey spec §9 (middots ·, em dashes —,
   single-char ellipses …, typographic apostrophes '). */

export const strings = {
  toastSaved: "Saved on this phone",
  toastFlagged: "Flagged for review",
  toastUnflagged: "Flag removed",
  toastTimesUp: "Time’s up — everything you answered was submitted",
  toastAllSent: "Everything sent to school",
  sendingLeft: (n: number) => `Sending… ${n} left`,
} as const;
