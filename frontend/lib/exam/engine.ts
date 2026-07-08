/**
 * Exam engine — the journey's REAL state layer, replacing the localStorage
 * demo driver. Pure TS store (no React): IndexedDB persistence via ./db,
 * envelope encryption at write time via ./crypto, drip sync via ./outbox.
 * UI layers subscribe with subscribeEngine/getEngineState (adapter hook in
 * ./use-engine.ts). (Graduates to packages/* when the RN port starts.)
 *
 * Wall-clock rule (TECHSTACK §3): the timer anchors to the SERVER's
 * deadlineAt — remaining time is always `deadlineAt - now`, never a local
 * countdown, so backgrounding/crash/reload cannot stretch an attempt.
 *
 * Volatile plaintext rule: the student's selected/typed values live only in
 * UI memory for the session. IndexedDB keeps the EncryptedEnvelope plus a
 * `display` echo that is at most an option id (see ./db).
 */

import { apiGet, apiPost } from "@/lib/api";
import type {
  AnswerEvent,
  AttemptStatusResponse,
  ExamListItem,
  ExamPackage,
  StartAttemptResponse,
  SubmitEvent,
} from "@rl/schemas";
import { encryptAnswer } from "./crypto";
import {
  getAllAttempts,
  getAllPackages,
  getOutbox,
  putAttempt,
  putPackage,
  updateAttempt,
  writeAnswer,
  writeSubmit,
  type StoredAnswer,
  type StoredAttempt,
} from "./db";
import { drainOutbox, notifyOutboxChanged, subscribeOutbox } from "./outbox";

/* --------------------------------- state --------------------------------- */

/** A list entry; `cached` marks entries rebuilt from on-device packages when
    the live list is unreachable (the state language: never an error page). */
export interface UiExamItem extends ExamListItem {
  cached?: boolean;
}

export interface DownloadState {
  pct: number;
  stalled: boolean;
}

export interface AttemptOutbox {
  /** Distinct questions with an event still waiting to send. */
  pendingAnswers: number;
  submitPending: boolean;
  rejected: number;
}

export interface OutboxSummary {
  /** All pending events (answers + submits + course progress). */
  pending: number;
  /** Pending course reading-progress events (shared outbox, Phase III). */
  progressPending: number;
  rejected: number;
  lastSentMs: number | null;
  pendingBytes: number;
  byAttempt: Record<string, AttemptOutbox>;
}

export interface EngineState {
  ready: boolean;
  online: boolean;
  /** false ⇒ `exams` was rebuilt from on-device packages (fetch failed). */
  listLive: boolean;
  exams: UiExamItem[];
  packages: Record<string, ExamPackage>; // by examId
  attempts: Record<string, StoredAttempt>; // by examId (one attempt per exam)
  downloads: Record<string, DownloadState>; // by examId, while downloading
  statuses: Record<string, AttemptStatusResponse>; // by attemptId
  outbox: OutboxSummary;
  /** Set at hydration when an in_progress attempt exists → recovery screen. */
  recoveryExamId: string | null;
}

const EMPTY_OUTBOX: OutboxSummary = {
  pending: 0,
  progressPending: 0,
  rejected: 0,
  lastSentMs: null,
  pendingBytes: 0,
  byAttempt: {},
};

const INITIAL_STATE: EngineState = {
  ready: false,
  online: true,
  listLive: false,
  exams: [],
  packages: {},
  attempts: {},
  downloads: {},
  statuses: {},
  outbox: EMPTY_OUTBOX,
  recoveryExamId: null,
};

let state: EngineState = INITIAL_STATE;

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeEngine(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getEngineState(): EngineState {
  return state;
}

/** Stable server-render snapshot (journey renders null until `ready`). */
export function getServerEngineState(): EngineState {
  return INITIAL_STATE;
}

function set(patch: Partial<EngineState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function setAttempt(attempt: StoredAttempt): void {
  set({ attempts: { ...state.attempts, [attempt.examId]: attempt } });
}

/* ------------------------------- utilities ------------------------------- */

export function countAnswered(attempt: StoredAttempt): number {
  return Object.values(attempt.answers).filter((a) => a.hasValue).length;
}

function fmtSubmitTime(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/* ---------------------------------- init --------------------------------- */

let initPromise: Promise<void> | null = null;

/** Idempotent hydration — safe to call from every exam surface mount. */
export function initEngine(): Promise<void> {
  initPromise ??= doInit().catch(() => {
    initPromise = null; // storage hiccup — allow a retry on next mount
  });
  return initPromise;
}

async function doInit(): Promise<void> {
  if (typeof window === "undefined") return;
  const [packages, attempts] = await Promise.all([
    getAllPackages(),
    getAllAttempts(),
  ]);

  const packagesById: Record<string, ExamPackage> = {};
  for (const pkg of packages) packagesById[pkg.examId] = pkg;
  const attemptsByExam: Record<string, StoredAttempt> = {};
  for (const attempt of attempts) attemptsByExam[attempt.examId] = attempt;

  set({
    online: navigator.onLine,
    packages: packagesById,
    attempts: attemptsByExam,
    outbox: await computeOutboxSummary(),
  });

  // Local-first deadline enforcement: an attempt whose wall-clock deadline
  // passed while the app was closed submits now (answers are already safe).
  for (const attempt of Object.values(attemptsByExam)) {
    if (
      attempt.state === "in_progress" &&
      Date.parse(attempt.deadlineAt) <= Date.now()
    ) {
      await submitAttempt(attempt.examId, {
        at: new Date(attempt.deadlineAt),
      });
    }
  }

  const recovering = Object.values(state.attempts).find(
    (a) => a.state === "in_progress",
  );
  set({ ready: true, recoveryExamId: recovering?.examId ?? null });

  window.addEventListener("online", () => {
    set({ online: true });
    void refreshExams();
    void retryStalledDownloads();
  });
  window.addEventListener("offline", () => set({ online: false }));
  subscribeOutbox(() => {
    void refreshOutboxSummary();
  });

  void refreshExams();
  void drainOutbox(true); // flush anything left from the last session
}

/* ------------------------------- exam list ------------------------------- */

export async function refreshExams(): Promise<void> {
  try {
    const items = await apiGet<ExamListItem[]>("/exams");
    set({ exams: items, listLive: true });
  } catch {
    // Calm fallback: whatever is on this phone remains startable/resumable.
    set({ exams: buildCachedList(), listLive: false });
  }
}

function buildCachedList(): UiExamItem[] {
  return Object.values(state.packages).map((pkg) => {
    const attempt = state.attempts[pkg.examId];
    const status = attempt ? state.statuses[attempt.attemptId] : undefined;
    return {
      id: pkg.examId,
      title: pkg.title,
      totalItems: pkg.questions.length,
      durationMinutes: pkg.durationMinutes,
      opensAt: new Date(0).toISOString(), // downloaded ⇒ it was open
      closesAt: pkg.closesAt,
      attemptState: status?.state ?? attempt?.state ?? "none",
      attemptId: attempt?.attemptId ?? null,
      score: status?.score ?? null,
      packageBytes: 0,
      cached: true,
    };
  });
}

/* -------------------------------- download ------------------------------- */

function setDownload(examId: string, download: DownloadState | null): void {
  const downloads = { ...state.downloads };
  if (download) downloads[examId] = download;
  else delete downloads[examId];
  set({ downloads });
}

export async function downloadExam(examId: string): Promise<void> {
  if (state.packages[examId]) return; // already on this phone
  setDownload(examId, { pct: 12, stalled: false });
  try {
    const pkg = await apiGet<ExamPackage>(`/exams/${examId}/package`);
    setDownload(examId, { pct: 88, stalled: false });
    await putPackage(pkg);
    set({ packages: { ...state.packages, [examId]: pkg } });
    setDownload(examId, null);
  } catch {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      // Keep the card in its calm stalled state; 'online' retries it.
      setDownload(examId, { pct: 12, stalled: true });
    } else {
      setDownload(examId, null); // back to the download button
      throw new Error("download failed");
    }
  }
}

async function retryStalledDownloads(): Promise<void> {
  for (const [examId, download] of Object.entries(state.downloads)) {
    if (download.stalled) {
      await downloadExam(examId).catch(() => undefined);
    }
  }
}

/* --------------------------------- attempt ------------------------------- */

/** Online-only (server anchors startedAt/deadlineAt); idempotent re-POST. */
export async function startAttempt(examId: string): Promise<StoredAttempt> {
  const existing = state.attempts[examId];
  if (existing && existing.state === "in_progress") return existing;
  const res = await apiPost<StartAttemptResponse>(
    `/exams/${examId}/attempts`,
  );
  const attempt: StoredAttempt = {
    attemptId: res.attemptId,
    examId: res.examId,
    state: "in_progress",
    startedAt: res.startedAt,
    deadlineAt: res.deadlineAt,
    answers: {},
    flags: [],
    currentIndex: 0,
    submitTime: "",
    remindSet: false,
  };
  await putAttempt(attempt);
  setAttempt(attempt);
  return attempt;
}

/* ---------------------------------- answer ------------------------------- */

/** Per-question write chains keep rapid keystrokes ordered (LWW-safe). */
const writeChains = new Map<string, Promise<void>>();

/**
 * Instant local save: encrypt → store + enqueue atomically. Fire-and-forget
 * from the UI; the saved chip reflects the stored record.
 */
export function answerQuestion(
  examId: string,
  questionId: string,
  value: string,
  display: string | null,
): void {
  const key = `${examId}:${questionId}`;
  const prev = writeChains.get(key) ?? Promise.resolve();
  const next = prev
    .then(() => doAnswer(examId, questionId, value, display))
    .catch(() => undefined);
  writeChains.set(key, next);
}

async function doAnswer(
  examId: string,
  questionId: string,
  value: string,
  display: string | null,
): Promise<void> {
  const pkg = state.packages[examId];
  const attempt = state.attempts[examId];
  if (!pkg || !attempt || attempt.state !== "in_progress") return;
  const clientTs = Date.now();
  const payload = await encryptAnswer(pkg.publicKeyPem, pkg.keyVersion, value);
  const stored: StoredAnswer = {
    envelope: payload,
    clientTs,
    display,
    hasValue: value !== "",
  };
  const event: AnswerEvent = {
    kind: "answer",
    id: crypto.randomUUID(),
    attemptId: attempt.attemptId,
    questionId,
    payload,
    clientTs,
  };
  const updated = await writeAnswer(attempt.attemptId, questionId, stored, event);
  if (updated) setAttempt(updated);
  notifyOutboxChanged();
}

/* -------------------------- flags / index / remind ------------------------ */

export async function toggleFlag(
  examId: string,
  questionId: string,
): Promise<boolean> {
  const attempt = state.attempts[examId];
  if (!attempt) return false;
  const on = !attempt.flags.includes(questionId);
  const flags = on
    ? [...attempt.flags, questionId]
    : attempt.flags.filter((id) => id !== questionId);
  const updated = await updateAttempt(attempt.attemptId, { flags });
  if (updated) setAttempt(updated);
  return on;
}

export async function setCurrentIndex(
  examId: string,
  index: number,
): Promise<void> {
  const attempt = state.attempts[examId];
  if (!attempt || attempt.currentIndex === index) return;
  const updated = await updateAttempt(attempt.attemptId, {
    currentIndex: index,
  });
  if (updated) setAttempt(updated);
}

export async function setRemindSet(examId: string): Promise<void> {
  const attempt = state.attempts[examId];
  if (!attempt) return;
  const updated = await updateAttempt(attempt.attemptId, { remindSet: true });
  if (updated) setAttempt(updated);
}

/* --------------------------------- submit -------------------------------- */

/**
 * Local-first submit: the SubmitEvent is enqueued atomically with the state
 * flip — works with zero signal; the outbox delivers it when connected.
 */
export async function submitAttempt(
  examId: string,
  opts?: { at?: Date },
): Promise<void> {
  const attempt = state.attempts[examId];
  if (!attempt || attempt.state !== "in_progress") return;
  const event: SubmitEvent = {
    kind: "submit",
    id: crypto.randomUUID(),
    attemptId: attempt.attemptId,
    answeredCount: countAnswered(attempt),
    clientTs: Date.now(),
  };
  const updated = await writeSubmit(
    attempt.attemptId,
    event,
    fmtSubmitTime(opts?.at ?? new Date()),
  );
  if (updated) setAttempt(updated);
  if (state.recoveryExamId === examId) set({ recoveryExamId: null });
  notifyOutboxChanged();
  void drainOutbox(true);
}

/* ------------------------------ status polling --------------------------- */

export async function pollAttemptStatus(attemptId: string): Promise<void> {
  try {
    const res = await apiGet<AttemptStatusResponse>(`/attempts/${attemptId}`);
    const previous = state.statuses[attemptId];
    if (
      previous &&
      previous.state === res.state &&
      previous.answersReceived === res.answersReceived &&
      previous.score === res.score
    ) {
      return; // unchanged — keep the store reference stable
    }
    set({ statuses: { ...state.statuses, [attemptId]: res } });
    if (res.state === "graded" && previous?.state !== "graded") {
      void refreshExams(); // the list's score chip updates too
    }
  } catch {
    /* stays calm — the next poll retries */
  }
}

/* ------------------------------ outbox summary --------------------------- */

export async function sendNow(): Promise<number> {
  await drainOutbox(true);
  return state.outbox.pending;
}

async function refreshOutboxSummary(): Promise<void> {
  set({ outbox: await computeOutboxSummary() });
}

async function computeOutboxSummary(): Promise<OutboxSummary> {
  const records = await getOutbox();
  let pending = 0;
  let progressPending = 0;
  let rejected = 0;
  let lastSentMs: number | null = null;
  const pendingEvents: unknown[] = [];
  const perAttempt = new Map<
    string,
    { questionIds: Set<string>; submitPending: boolean; rejected: number }
  >();

  for (const record of records) {
    // Course progress events share the outbox but have no attempt bookkeeping.
    if (record.event.kind === "progress") {
      if (record.status === "pending") {
        pending += 1;
        progressPending += 1;
        pendingEvents.push(record.event);
      } else if (record.status === "rejected") {
        rejected += 1;
      } else if (
        record.sentAtMs !== null &&
        (lastSentMs === null || record.sentAtMs > lastSentMs)
      ) {
        lastSentMs = record.sentAtMs;
      }
      continue;
    }
    const attemptId = record.event.attemptId;
    let slot = perAttempt.get(attemptId);
    if (!slot) {
      slot = { questionIds: new Set(), submitPending: false, rejected: 0 };
      perAttempt.set(attemptId, slot);
    }
    if (record.status === "pending") {
      pending += 1;
      pendingEvents.push(record.event);
      if (record.event.kind === "answer") {
        slot.questionIds.add(record.event.questionId);
      } else {
        slot.submitPending = true;
      }
    } else if (record.status === "rejected") {
      rejected += 1;
      slot.rejected += 1;
    } else if (
      record.sentAtMs !== null &&
      (lastSentMs === null || record.sentAtMs > lastSentMs)
    ) {
      lastSentMs = record.sentAtMs;
    }
  }

  const byAttempt: Record<string, AttemptOutbox> = {};
  for (const [attemptId, slot] of perAttempt) {
    byAttempt[attemptId] = {
      pendingAnswers: slot.questionIds.size,
      submitPending: slot.submitPending,
      rejected: slot.rejected,
    };
  }
  return {
    pending,
    progressPending,
    rejected,
    lastSentMs,
    pendingBytes: pendingEvents.length
      ? JSON.stringify(pendingEvents).length
      : 0,
    byAttempt,
  };
}
