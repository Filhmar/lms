/**
 * IndexedDB repository for the exam journey — DB `resilient-learn` v1.
 * Pure TS on the `idb` package (PRD-prescribed); no React, no DOM beyond
 * IndexedDB. (Graduates to packages/offline-store when the RN port starts.)
 *
 * PRD "Local persistence" rules honored here:
 *  · UI writes land in IndexedDB first — never localStorage for exam data;
 *  · answer writes are ATOMIC with their sync enqueue (one transaction
 *    across `attempts` + `outbox`: both succeed or both fail);
 *  · privacy — an answer at rest is the EncryptedEnvelope plus a `display`
 *    echo that is only ever the selected OPTION ID (mcq/tf). Free-text
 *    (ident) answers are never stored in plaintext: display stays null and
 *    the UI re-prompts from volatile memory or shows "answered".
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  AnswerEvent,
  EncryptedEnvelope,
  ExamPackage,
  SubmitEvent,
  SyncEvent,
} from "@rl/schemas";

/* --------------------------------- shapes -------------------------------- */

export interface StoredAnswer {
  envelope: EncryptedEnvelope;
  /** LWW timestamp — stamped at write time; the server relies on it. */
  clientTs: number;
  /** mcq/tf: the selected option id; ident: null (never plaintext at rest). */
  display: string | null;
  /** false when the student cleared the field (an empty value was synced). */
  hasValue: boolean;
}

export interface StoredAttempt {
  attemptId: string;
  examId: string;
  /** Local lifecycle only — grading/graded come from GET /attempts/:id. */
  state: "in_progress" | "submitted";
  /** Server wall-clock anchors from StartAttemptResponse (ISO). */
  startedAt: string;
  deadlineAt: string;
  answers: Record<string, StoredAnswer>;
  /** Flagged question ids — local-only, never synced. */
  flags: string[];
  currentIndex: number;
  /** 'h:mm AM|PM' captured at submit, for display. */
  submitTime: string;
  /** iOS "remind me to reopen" chosen. */
  remindSet: boolean;
}

export type OutboxStatus = "pending" | "sent" | "rejected";

export interface OutboxRecord {
  /** autoIncrement key — FIFO drain order. */
  id?: number;
  event: SyncEvent;
  status: OutboxStatus;
  tries: number;
  /** ms epoch of the server ack (merged/stale/duplicate). */
  sentAtMs: number | null;
  /** Server reason when rejected. */
  reason?: string;
}

interface RlDb extends DBSchema {
  exam_packages: { key: string; value: ExamPackage };
  attempts: { key: string; value: StoredAttempt };
  outbox: { key: number; value: OutboxRecord };
}

/* ---------------------------------- open --------------------------------- */

const DB_NAME = "resilient-learn";

let dbPromise: Promise<IDBPDatabase<RlDb>> | null = null;

function getDb(): Promise<IDBPDatabase<RlDb>> {
  dbPromise ??= openDB<RlDb>(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore("exam_packages", { keyPath: "examId" });
      db.createObjectStore("attempts", { keyPath: "attemptId" });
      db.createObjectStore("outbox", { keyPath: "id", autoIncrement: true });
    },
  });
  return dbPromise;
}

/* ------------------------------- packages -------------------------------- */

export async function putPackage(pkg: ExamPackage): Promise<void> {
  await (await getDb()).put("exam_packages", pkg);
}

export async function getAllPackages(): Promise<ExamPackage[]> {
  return (await getDb()).getAll("exam_packages");
}

/* ------------------------------- attempts -------------------------------- */

export async function putAttempt(attempt: StoredAttempt): Promise<void> {
  await (await getDb()).put("attempts", attempt);
}

export async function getAllAttempts(): Promise<StoredAttempt[]> {
  return (await getDb()).getAll("attempts");
}

/** Read-modify-write of non-answer fields (flags / currentIndex / remindSet). */
export async function updateAttempt(
  attemptId: string,
  patch: Partial<Pick<StoredAttempt, "flags" | "currentIndex" | "remindSet">>,
): Promise<StoredAttempt | null> {
  const db = await getDb();
  const tx = db.transaction("attempts", "readwrite");
  const attempt = await tx.store.get(attemptId);
  if (!attempt) {
    await tx.done;
    return null;
  }
  const updated = { ...attempt, ...patch };
  await tx.store.put(updated);
  await tx.done;
  return updated;
}

/**
 * ATOMIC answer write: upsert the encrypted answer AND enqueue its sync
 * event in one transaction (they succeed or fail together). A still-pending
 * outbox event for the same question is superseded in place so the outbox
 * never carries two versions of one answer.
 */
export async function writeAnswer(
  attemptId: string,
  questionId: string,
  answer: StoredAnswer,
  event: AnswerEvent,
): Promise<StoredAttempt | null> {
  const db = await getDb();
  const tx = db.transaction(["attempts", "outbox"], "readwrite");
  const attempts = tx.objectStore("attempts");
  const attempt = await attempts.get(attemptId);
  if (!attempt) {
    await tx.done;
    return null;
  }
  const updated: StoredAttempt = {
    ...attempt,
    answers: { ...attempt.answers, [questionId]: answer },
  };
  await attempts.put(updated);

  const outbox = tx.objectStore("outbox");
  let cursor = await outbox.openCursor();
  while (cursor) {
    const r = cursor.value;
    if (
      r.status === "pending" &&
      r.event.kind === "answer" &&
      r.event.attemptId === attemptId &&
      r.event.questionId === questionId
    ) {
      await cursor.delete();
    }
    cursor = await cursor.continue();
  }
  await outbox.add({ event, status: "pending", tries: 0, sentAtMs: null });
  await tx.done;
  return updated;
}

/** ATOMIC submit: flip the attempt to submitted AND enqueue the SubmitEvent. */
export async function writeSubmit(
  attemptId: string,
  event: SubmitEvent,
  submitTime: string,
): Promise<StoredAttempt | null> {
  const db = await getDb();
  const tx = db.transaction(["attempts", "outbox"], "readwrite");
  const attempts = tx.objectStore("attempts");
  const attempt = await attempts.get(attemptId);
  if (!attempt || attempt.state !== "in_progress") {
    await tx.done;
    return attempt ?? null;
  }
  const updated: StoredAttempt = { ...attempt, state: "submitted", submitTime };
  await attempts.put(updated);
  await tx.objectStore("outbox").add({
    event,
    status: "pending",
    tries: 0,
    sentAtMs: null,
  });
  await tx.done;
  return updated;
}

/* -------------------------------- outbox --------------------------------- */

/** All records in key (FIFO) order. */
export async function getOutbox(): Promise<OutboxRecord[]> {
  return (await getDb()).getAll("outbox");
}

export interface OutboxMark {
  id: number;
  status: OutboxStatus;
  sentAtMs: number | null;
  reason?: string;
}

export async function markOutbox(marks: OutboxMark[]): Promise<void> {
  if (marks.length === 0) return;
  const db = await getDb();
  const tx = db.transaction("outbox", "readwrite");
  for (const mark of marks) {
    const record = await tx.store.get(mark.id);
    if (!record) continue;
    await tx.store.put({
      ...record,
      status: mark.status,
      sentAtMs: mark.sentAtMs ?? record.sentAtMs,
      ...(mark.reason ? { reason: mark.reason } : {}),
    });
  }
  await tx.done;
}

export async function bumpOutboxTries(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDb();
  const tx = db.transaction("outbox", "readwrite");
  for (const id of ids) {
    const record = await tx.store.get(id);
    if (!record) continue;
    await tx.store.put({ ...record, tries: record.tries + 1 });
  }
  await tx.done;
}
