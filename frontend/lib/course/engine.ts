/**
 * Course engine — the courses/downloads surfaces' REAL state layer,
 * replacing the fixture drivers. Pure TS store (no React): IndexedDB
 * persistence via ./db (shared `resilient-learn` DB), drip sync through the
 * SHARED exam outbox (lib/exam/outbox — progress events ride the same
 * POST /sync/batch pipeline as answers). UI layers subscribe with
 * subscribeCourseEngine/getCourseEngineState (adapter hook in
 * ./use-engine.ts). (Graduates to packages/* when the RN port starts.)
 *
 * Offline-first rules (CLAUDE.md "Offline-first data flow"):
 *  · the course list is network-first with the on-device manifests as the
 *    calm fallback (never an error page);
 *  · a page completion writes IndexedDB + enqueues its LWW ProgressEvent
 *    atomically; the outbox drains it whenever there's signal;
 *  · server progress is hydrated on connect and UNION-merged — local
 *    completions also reach the server via LWW, so nothing is ever lost.
 */

import { apiGet, apiGetRaw } from "@/lib/api";
import type {
  CourseListItem,
  CourseManifest,
  CoursePage,
  CourseProgressResponse,
  ProgressEvent,
} from "@rl/schemas";
import { getAllPackages } from "@/lib/exam/db";
import {
  drainOutbox,
  notifyOutboxChanged,
  subscribeOutbox,
} from "@/lib/exam/outbox";
import { getOutbox } from "@/lib/exam/db";
import {
  deleteAsset,
  deleteCourseContent,
  getAllAssets,
  getAllManifests,
  getAllProgress,
  getAsset,
  progressKey,
  putAsset,
  putManifest,
  writeProgress,
  type StoredCourseManifest,
  type StoredCourseProgress,
} from "./db";

/* --------------------------------- state --------------------------------- */

/** A list entry; `cached` marks entries rebuilt from on-device manifests when
    the live list is unreachable (the state language: never an error page). */
export interface UiCourseItem extends CourseListItem {
  cached?: boolean;
}

export interface CourseDownloadState {
  pct: number;
  stalled: boolean;
}

export interface VideoDownloadState {
  pct: number;
  stalled: boolean;
  receivedBytes: number;
  totalBytes: number;
}

/** Stored-video bookkeeping without holding blobs in memory. */
export interface AssetMeta {
  assetPath: string;
  courseId: string;
  sizeBytes: number;
  storedAt: number;
}

export interface PageProgress {
  clientTs: number;
  /** true once the server is known to have it. */
  synced: boolean;
}

export interface CourseOutboxSummary {
  /** All pending events in the shared outbox (answers + submits + progress). */
  pending: number;
  /** Pending reading-progress events only. */
  progressPending: number;
  lastSentMs: number | null;
}

const EMPTY_OUTBOX: CourseOutboxSummary = {
  pending: 0,
  progressPending: 0,
  lastSentMs: null,
};

export interface CourseEngineState {
  ready: boolean;
  online: boolean;
  /** false ⇒ `courses` was rebuilt from on-device manifests (fetch failed). */
  listLive: boolean;
  courses: UiCourseItem[];
  manifests: Record<string, StoredCourseManifest>; // by courseId
  assets: Record<string, AssetMeta>; // by assetPath
  progress: Record<string, Record<string, PageProgress>>; // courseId → pageId
  downloads: Record<string, CourseDownloadState>; // manifest downloads, by courseId
  videoDownloads: Record<string, VideoDownloadState>; // by assetPath
  /** Exam packages on this phone (assessment-embed readiness + Downloads). */
  storedExamIds: string[];
  outbox: CourseOutboxSummary;
  /** A put was refused by the browser quota — show the storage-full banner. */
  storageFull: boolean;
}

const INITIAL_STATE: CourseEngineState = {
  ready: false,
  online: true,
  listLive: false,
  courses: [],
  manifests: {},
  assets: {},
  progress: {},
  downloads: {},
  videoDownloads: {},
  storedExamIds: [],
  outbox: EMPTY_OUTBOX,
  storageFull: false,
};

let state: CourseEngineState = INITIAL_STATE;

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeCourseEngine(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCourseEngineState(): CourseEngineState {
  return state;
}

/** Stable server-render snapshot (surfaces render null until `ready`). */
export function getServerCourseEngineState(): CourseEngineState {
  return INITIAL_STATE;
}

function set(patch: Partial<CourseEngineState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

/* ------------------------------- utilities ------------------------------- */

/** Manifest pages flattened across chapters in reading order. */
export interface FlatPage {
  page: CoursePage;
  chapterSeq: number;
  chapterTitle: string;
  /** 0-based position within the chapter / across the course. */
  indexInChapter: number;
  chapterPageCount: number;
  globalIndex: number;
}

export function flattenPages(manifest: CourseManifest): FlatPage[] {
  const flat: FlatPage[] = [];
  const chapters = [...manifest.chapters].sort((a, b) => a.seq - b.seq);
  for (const chapter of chapters) {
    const pages = [...chapter.pages].sort((a, b) => a.seq - b.seq);
    pages.forEach((page, i) => {
      flat.push({
        page,
        chapterSeq: chapter.seq,
        chapterTitle: chapter.title,
        indexInChapter: i,
        chapterPageCount: pages.length,
        globalIndex: flat.length,
      });
    });
  }
  return flat;
}

/** Completed-page count for a course, counting only pages that still exist
    in the stored manifest (falls back to the raw local count without one). */
export function completedCount(
  courseId: string,
  eng: CourseEngineState = state,
): number {
  const done = eng.progress[courseId];
  if (!done) return 0;
  const stored = eng.manifests[courseId];
  if (!stored) return Object.keys(done).length;
  let count = 0;
  for (const chapter of stored.manifest.chapters) {
    for (const page of chapter.pages) if (done[page.id]) count += 1;
  }
  return count;
}

/** Approximate on-disk size of a stored manifest (its JSON). */
export function manifestBytesOf(stored: StoredCourseManifest): number {
  return JSON.stringify(stored.manifest).length;
}

/** Downloaded-video bytes belonging to one course. */
export function courseVideoBytes(
  courseId: string,
  eng: CourseEngineState = state,
): number {
  return Object.values(eng.assets)
    .filter((a) => a.courseId === courseId)
    .reduce((sum, a) => sum + a.sizeBytes, 0);
}

/** apiGet/apiGetRaw prepend /api/v1 — the manifest's assetPath includes it. */
function apiPathOf(assetPath: string): string {
  return assetPath.replace(/^\/api\/v1/, "");
}

function isQuotaError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "QuotaExceededError";
}

/* ---------------------------------- init --------------------------------- */

let initPromise: Promise<void> | null = null;

/** Idempotent hydration — safe to call from every course surface mount. */
export function initCourseEngine(): Promise<void> {
  initPromise ??= doInit().catch(() => {
    initPromise = null; // storage hiccup — allow a retry on next mount
  });
  return initPromise;
}

async function doInit(): Promise<void> {
  if (typeof window === "undefined") return;
  const [manifests, assets, progressRecords, packages] = await Promise.all([
    getAllManifests(),
    getAllAssets(),
    getAllProgress(),
    getAllPackages(),
  ]);

  const manifestsById: Record<string, StoredCourseManifest> = {};
  for (const m of manifests) manifestsById[m.courseId] = m;
  const assetMetas: Record<string, AssetMeta> = {};
  for (const a of assets) {
    assetMetas[a.assetPath] = {
      assetPath: a.assetPath,
      courseId: a.courseId,
      sizeBytes: a.sizeBytes,
      storedAt: a.storedAt,
    };
  }

  set({
    online: navigator.onLine,
    manifests: manifestsById,
    assets: assetMetas,
    progress: groupProgress(progressRecords),
    storedExamIds: packages.map((p) => p.examId),
    outbox: await computeOutboxSummary(),
    ready: true,
  });

  window.addEventListener("online", () => {
    set({ online: true });
    void refreshCourses();
    void hydrateAllProgress();
    void retryStalledDownloads();
  });
  window.addEventListener("offline", () => set({ online: false }));
  subscribeOutbox(() => {
    void refreshOutboxSummary();
  });

  void refreshCourses();
  void hydrateAllProgress();
  void drainOutbox(true); // flush anything left from the last session
}

function groupProgress(
  records: StoredCourseProgress[],
): Record<string, Record<string, PageProgress>> {
  const grouped: Record<string, Record<string, PageProgress>> = {};
  for (const r of records) {
    (grouped[r.courseId] ??= {})[r.pageId] = {
      clientTs: r.clientTs,
      synced: r.synced,
    };
  }
  return grouped;
}

/* ------------------------------- course list ------------------------------ */

export async function refreshCourses(): Promise<void> {
  try {
    const items = await apiGet<CourseListItem[]>("/courses");
    set({ courses: items, listLive: true });
  } catch {
    // Calm fallback: whatever is on this phone remains readable.
    set({ courses: buildCachedList(), listLive: false });
  }
}

function buildCachedList(): UiCourseItem[] {
  return Object.values(state.manifests).map((stored) => {
    const m = stored.manifest;
    const totalPages = m.chapters.reduce((sum, ch) => sum + ch.pages.length, 0);
    return {
      id: m.courseId,
      title: m.title,
      subject: m.subject,
      version: m.version,
      chapters: m.chapters.length,
      totalPages,
      completedPages: completedCount(m.courseId),
      manifestBytes: manifestBytesOf(stored),
      cached: true,
    };
  });
}

/* ----------------------------- course download ---------------------------- */

function setDownload(courseId: string, download: CourseDownloadState | null): void {
  const downloads = { ...state.downloads };
  if (download) downloads[courseId] = download;
  else delete downloads[courseId];
  set({ downloads });
}

/** Fetch + store a course manifest. `refresh` re-downloads a newer version. */
export async function downloadCourse(
  courseId: string,
  opts?: { refresh?: boolean },
): Promise<void> {
  if (state.manifests[courseId] && !opts?.refresh) return; // already on this phone
  if (state.downloads[courseId] && !state.downloads[courseId].stalled) return;
  setDownload(courseId, { pct: 12, stalled: false });
  try {
    const manifest = await apiGet<CourseManifest>(`/courses/${courseId}/manifest`);
    setDownload(courseId, { pct: 88, stalled: false });
    const stored = await putManifest(manifest);
    set({
      manifests: { ...state.manifests, [courseId]: stored },
      storageFull: false,
    });
    setDownload(courseId, null);
    void hydrateProgress(courseId);
  } catch (err) {
    if (isQuotaError(err)) {
      setDownload(courseId, null);
      set({ storageFull: true });
      throw err;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      // Keep the card in its calm stalled state; 'online' retries it.
      setDownload(courseId, { pct: 12, stalled: true });
    } else {
      setDownload(courseId, null); // back to the Get affordance
      throw new Error("download failed");
    }
  }
}

/** Remove a course's downloaded content. Progress and grades stay safe. */
export async function removeCourseContent(courseId: string): Promise<void> {
  await deleteCourseContent(courseId);
  const manifests = { ...state.manifests };
  delete manifests[courseId];
  const assets: Record<string, AssetMeta> = {};
  for (const [key, meta] of Object.entries(state.assets)) {
    if (meta.courseId !== courseId) assets[key] = meta;
  }
  set({ manifests, assets, storageFull: false });
  if (state.listLive) void refreshCourses();
  else set({ courses: buildCachedList() });
}

/* ------------------------------ video download ---------------------------- */

function setVideoDownload(
  assetPath: string,
  download: VideoDownloadState | null,
): void {
  const videoDownloads = { ...state.videoDownloads };
  if (download) videoDownloads[assetPath] = download;
  else delete videoDownloads[assetPath];
  set({ videoDownloads });
}

/**
 * Whole-file video download with byte-true progress (streamed reader), then
 * one atomic IndexedDB put. QuotaExceededError → storage-full banner state.
 */
export async function downloadVideo(
  courseId: string,
  page: CoursePage,
): Promise<void> {
  const video = page.video;
  if (!video) return;
  const assetPath = video.assetPath;
  if (state.assets[assetPath]) return; // already on this phone
  const inflight = state.videoDownloads[assetPath];
  if (inflight && !inflight.stalled) return;

  setVideoDownload(assetPath, {
    pct: 0,
    stalled: false,
    receivedBytes: 0,
    totalBytes: video.sizeBytes,
  });
  try {
    const res = await apiGetRaw(apiPathOf(assetPath));
    const totalBytes =
      Number(res.headers.get("content-length")) || video.sizeBytes || 0;
    const contentType = res.headers.get("content-type") ?? "video/mp4";

    const chunks: BlobPart[] = [];
    let receivedBytes = 0;
    const reader = res.body?.getReader();
    if (reader) {
      let lastPct = -1;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        receivedBytes += value.byteLength;
        const pct = totalBytes
          ? Math.min(99, Math.floor((receivedBytes / totalBytes) * 100))
          : 50;
        if (pct !== lastPct) {
          lastPct = pct;
          setVideoDownload(assetPath, {
            pct,
            stalled: false,
            receivedBytes,
            totalBytes,
          });
        }
      }
    } else {
      const buf = await res.arrayBuffer();
      chunks.push(buf);
      receivedBytes = buf.byteLength;
    }

    const blob = new Blob(chunks, { type: contentType });
    await putAsset({
      assetPath,
      courseId,
      blob,
      sizeBytes: blob.size,
      storedAt: Date.now(),
    });
    set({
      assets: {
        ...state.assets,
        [assetPath]: {
          assetPath,
          courseId,
          sizeBytes: blob.size,
          storedAt: Date.now(),
        },
      },
      storageFull: false,
    });
    setVideoDownload(assetPath, null);
  } catch (err) {
    if (isQuotaError(err)) {
      setVideoDownload(assetPath, null);
      set({ storageFull: true });
      throw err;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      const current = state.videoDownloads[assetPath];
      // Calm stall — kept where it reached; 'online' retries it.
      setVideoDownload(assetPath, {
        pct: current?.pct ?? 0,
        stalled: true,
        receivedBytes: current?.receivedBytes ?? 0,
        totalBytes: current?.totalBytes ?? video.sizeBytes,
      });
    } else {
      setVideoDownload(assetPath, null);
      throw new Error("download failed");
    }
  }
}

/** Read a stored video blob (player object-URL source). */
export async function getVideoBlob(assetPath: string): Promise<Blob | null> {
  const record = await getAsset(assetPath);
  return record?.blob ?? null;
}

export async function removeVideo(assetPath: string): Promise<void> {
  await deleteAsset(assetPath);
  const assets = { ...state.assets };
  delete assets[assetPath];
  set({ assets, storageFull: false });
}

async function retryStalledDownloads(): Promise<void> {
  for (const [courseId, download] of Object.entries(state.downloads)) {
    if (download.stalled) await downloadCourse(courseId).catch(() => undefined);
  }
  for (const [assetPath, download] of Object.entries(state.videoDownloads)) {
    if (!download.stalled) continue;
    const located = locatePage(assetPath);
    if (located) {
      await downloadVideo(located.courseId, located.page).catch(() => undefined);
    }
  }
}

function locatePage(assetPath: string): { courseId: string; page: CoursePage } | null {
  for (const stored of Object.values(state.manifests)) {
    for (const chapter of stored.manifest.chapters) {
      for (const page of chapter.pages) {
        if (page.video?.assetPath === assetPath) {
          return { courseId: stored.courseId, page };
        }
      }
    }
  }
  return null;
}

/* -------------------------------- progress -------------------------------- */

/**
 * Instant local completion: IndexedDB write + outbox enqueue in ONE
 * transaction (like answers). Idempotent — a page completes once.
 */
export async function markPageComplete(
  courseId: string,
  pageId: string,
): Promise<void> {
  if (state.progress[courseId]?.[pageId]) return; // already done
  const clientTs = Date.now();
  const event: ProgressEvent = {
    kind: "progress",
    id: crypto.randomUUID(),
    courseId,
    pageId,
    clientTs,
  };
  const written = await writeProgress(
    { key: progressKey(courseId, pageId), courseId, pageId, clientTs, synced: false },
    event,
  );
  if (!written) return;
  set({
    progress: {
      ...state.progress,
      [courseId]: {
        ...state.progress[courseId],
        [pageId]: { clientTs, synced: false },
      },
    },
  });
  notifyOutboxChanged(); // the 30s drip / online trigger delivers it
}

/**
 * Hydrate server progress and UNION-merge: server completions the device
 * doesn't know yet are written locally as already-synced (no outbox event —
 * the server has them). Local-only completions stay pending in the outbox
 * and reach the server through the normal LWW drip.
 */
export async function hydrateProgress(courseId: string): Promise<void> {
  try {
    const res = await apiGet<CourseProgressResponse>(`/courses/${courseId}/progress`);
    const local = state.progress[courseId] ?? {};
    let changed = false;
    const merged = { ...local };
    for (const pageId of res.completedPageIds) {
      if (merged[pageId]?.synced) continue;
      const clientTs = merged[pageId]?.clientTs ?? Date.now();
      await writeProgress(
        { key: progressKey(courseId, pageId), courseId, pageId, clientTs, synced: true },
        null,
      );
      merged[pageId] = { clientTs, synced: true };
      changed = true;
    }
    if (changed) {
      set({ progress: { ...state.progress, [courseId]: merged } });
    }
  } catch {
    /* stays calm — local progress is already honest */
  }
}

async function hydrateAllProgress(): Promise<void> {
  for (const courseId of Object.keys(state.manifests)) {
    await hydrateProgress(courseId);
  }
}

/* ------------------------------ outbox summary ---------------------------- */

export async function sendNow(): Promise<number> {
  await drainOutbox(true);
  return state.outbox.pending;
}

async function refreshOutboxSummary(): Promise<void> {
  set({ outbox: await computeOutboxSummary() });
}

async function computeOutboxSummary(): Promise<CourseOutboxSummary> {
  const records = await getOutbox();
  let pending = 0;
  let progressPending = 0;
  let lastSentMs: number | null = null;
  for (const record of records) {
    if (record.status === "pending") {
      pending += 1;
      if (record.event.kind === "progress") progressPending += 1;
    } else if (
      record.status === "sent" &&
      record.sentAtMs !== null &&
      (lastSentMs === null || record.sentAtMs > lastSentMs)
    ) {
      lastSentMs = record.sentAtMs;
    }
  }
  return { pending, progressPending, lastSentMs };
}
