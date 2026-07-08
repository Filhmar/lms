/**
 * IndexedDB repository for the course journey — built on the ONE shared
 * `resilient-learn` DB (schema + upgrade path owned by lib/exam/db.ts).
 * Pure TS; no React. (Graduates to packages/offline-store with the exam
 * repository when the RN port starts.)
 *
 * PRD "Local persistence" rules honored here:
 *  · manifests/videos/progress land in IndexedDB first — never localStorage;
 *  · a page completion is ATOMIC with its sync enqueue (one transaction
 *    across `course_progress` + the shared `outbox`);
 *  · removing downloaded content NEVER touches `course_progress` or the
 *    outbox — "your progress stays safe, only the content leaves".
 */

import type { CourseManifest, ProgressEvent } from "@rl/schemas";
import {
  getDb,
  progressKey,
  type StoredCourseAsset,
  type StoredCourseManifest,
  type StoredCourseProgress,
} from "@/lib/exam/db";

export type {
  StoredCourseAsset,
  StoredCourseManifest,
  StoredCourseProgress,
} from "@/lib/exam/db";
export { progressKey } from "@/lib/exam/db";

/* ------------------------------- manifests ------------------------------- */

export async function putManifest(manifest: CourseManifest): Promise<StoredCourseManifest> {
  const record: StoredCourseManifest = {
    courseId: manifest.courseId,
    manifest,
    storedAt: Date.now(),
  };
  await (await getDb()).put("course_manifests", record);
  return record;
}

export async function getAllManifests(): Promise<StoredCourseManifest[]> {
  return (await getDb()).getAll("course_manifests");
}

/**
 * Remove a course's downloaded CONTENT: manifest + its stored videos, in one
 * transaction. Progress and the outbox are deliberately untouched.
 */
export async function deleteCourseContent(courseId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["course_manifests", "course_assets"], "readwrite");
  await tx.objectStore("course_manifests").delete(courseId);
  const assets = tx.objectStore("course_assets");
  let cursor = await assets.openCursor();
  while (cursor) {
    if (cursor.value.courseId === courseId) await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

/* -------------------------------- assets --------------------------------- */

/** May reject with a QuotaExceededError — callers surface the calm
    storage-full banner, never a broken download row. */
export async function putAsset(asset: StoredCourseAsset): Promise<void> {
  await (await getDb()).put("course_assets", asset);
}

export async function getAsset(assetPath: string): Promise<StoredCourseAsset | undefined> {
  return (await getDb()).get("course_assets", assetPath);
}

export async function getAllAssets(): Promise<StoredCourseAsset[]> {
  return (await getDb()).getAll("course_assets");
}

export async function deleteAsset(assetPath: string): Promise<void> {
  await (await getDb()).delete("course_assets", assetPath);
}

/* ------------------------------- progress -------------------------------- */

export async function getAllProgress(): Promise<StoredCourseProgress[]> {
  return (await getDb()).getAll("course_progress");
}

/**
 * ATOMIC page completion: write the progress record AND enqueue its
 * ProgressEvent in one transaction (both succeed or both fail). Returns
 * false (writing nothing) when the page is already completed — completions
 * are idempotent and never enqueue twice.
 *
 * `event` is null for server-hydrated completions (the server already has
 * them — nothing to send).
 */
export async function writeProgress(
  record: StoredCourseProgress,
  event: ProgressEvent | null,
): Promise<boolean> {
  const db = await getDb();
  const tx = db.transaction(["course_progress", "outbox"], "readwrite");
  const store = tx.objectStore("course_progress");
  const existing = await store.get(record.key);
  if (existing) {
    // Already completed. A server hydrate may still flip `synced` on.
    if (event === null && !existing.synced) {
      await store.put({ ...existing, synced: true });
    }
    await tx.done;
    return false;
  }
  await store.put(record);
  if (event) {
    await tx
      .objectStore("outbox")
      .add({ event, status: "pending", tries: 0, sentAtMs: null });
  }
  await tx.done;
  return true;
}
