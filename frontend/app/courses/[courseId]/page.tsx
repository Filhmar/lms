"use client";

/**
 * Course overview / TOC (key-screens p3b, d4 context) — REAL: the chapter
 * list renders from the stored manifest (IndexedDB), per-chapter done /
 * current states come from real progress (local ∪ server), the update
 * banner appears when the live list carries a newer manifest version, and
 * the download actions run the course engine. Designed states kept:
 * on-phone / not-downloaded / offline "Get later" / video-missing trailing
 * affordance.
 */

import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { Bar, Button, Icon } from "@rl/ui";
import * as copy from "@/lib/copy";
import { RequireAuth } from "@/lib/session";
import * as courseEngine from "@/lib/course/engine";
import {
  completedCount,
  courseVideoBytes,
  manifestBytesOf,
  type CourseEngineState,
} from "@/lib/course/engine";
import { useCourseEngine } from "@/lib/course/use-engine";
import type { CourseManifest } from "@rl/schemas";
import { BackButton, fmtBytes, setReadTarget } from "../course-shared";

export default function CourseTocPage() {
  return (
    <RequireAuth>
      <TocScreen />
    </RequireAuth>
  );
}

function TocScreen() {
  const { courseId } = useParams<{ courseId: string }>();
  const eng = useCourseEngine();
  const [liveMsg, setLiveMsg] = useState("");

  if (!eng.ready) return null;

  const item = eng.courses.find((c) => c.id === courseId) ?? null;
  const stored = eng.manifests[courseId] ?? null;
  const manifest = stored?.manifest ?? null;
  const downloading = eng.downloads[courseId];
  const online = eng.online;

  const title = manifest?.title ?? item?.title ?? "Course";
  const chapters = manifest?.chapters.length ?? item?.chapters ?? 0;
  const totalPages =
    manifest?.chapters.reduce((sum, ch) => sum + ch.pages.length, 0) ??
    item?.totalPages ??
    0;
  const done = manifest
    ? Math.max(completedCount(courseId, eng), item?.completedPages ?? 0)
    : (item?.completedPages ?? 0);
  const percent = totalPages > 0 ? Math.round((done / totalPages) * 100) : 0;
  const onDeviceBytes = stored
    ? manifestBytesOf(stored) + courseVideoBytes(courseId, eng)
    : 0;

  const sub = stored
    ? `${chapters} chapters · ${fmtBytes(onDeviceBytes)} on this phone`
    : `${chapters} chapters · not on this phone yet`;

  /** Live list says the school published a newer manifest version. */
  const updateAvailable =
    stored !== null && item !== null && eng.listLive && item.version > manifest!.version;

  return (
    <main
      style={{
        maxWidth: 480,
        margin: "0 auto",
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        gap: 11,
        padding: 16,
      }}
    >
      <span
        aria-live="polite"
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}
      >
        {liveMsg}
      </span>

      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <BackButton href="/courses" label="Back to courses" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>{title}</h1>
          <div style={{ fontSize: 11.5, color: "var(--color-ink-subtle)" }}>{sub}</div>
        </div>
        {stored ? (
          <span className="rl-num" style={{ fontSize: 12, fontWeight: 800, color: "var(--color-primary)" }}>
            {percent}%
          </span>
        ) : null}
      </div>

      {/* content-updated banner — re-downloads the manifest, sized first */}
      {updateAvailable && item ? (
        <div
          style={{
            background: "var(--color-warning-surface)",
            border: "1.5px solid var(--color-warning-border)",
            borderRadius: 14,
            padding: "12px 13px",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
              fontSize: 12.5,
              fontWeight: 700,
              color: "var(--color-on-device-fg)",
              lineHeight: 1.45,
            }}
          >
            <span style={{ display: "inline-flex", marginTop: 1 }}>
              <Icon name="download" size={14} />
            </span>
            Your school updated this course
          </div>
          {downloading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 10 }}>
              <Bar percent={downloading.pct} style={{ flex: 1 }} aria-label="Downloading the update" />
              <span
                className="rl-num"
                style={{ fontSize: 11.5, fontWeight: 700, color: "var(--color-primary)" }}
              >
                {downloading.pct}%
              </span>
            </div>
          ) : (
            <>
              <Button
                size="card"
                style={{ height: 40, marginTop: 9, fontSize: 12.5, fontWeight: 800 }}
                disabled={!online}
                onClick={() => {
                  void courseEngine
                    .downloadCourse(courseId, { refresh: true })
                    .then(() => setLiveMsg("This course is up to date on this phone."))
                    .catch(() => undefined);
                }}
              >
                Download update · {fmtBytes(item.manifestBytes)}
              </Button>
              {!online ? (
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--color-ink-subtle)",
                    marginTop: 6,
                    textAlign: "center",
                  }}
                >
                  {copy.syncCenter.downloadStalled}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {manifest ? (
        [...manifest.chapters]
          .sort((a, b) => a.seq - b.seq)
          .map((chapter) => (
            <ChapterRow
              key={chapter.id}
              chapter={chapter}
              manifest={manifest}
              eng={eng}
              courseId={courseId}
              online={online}
            />
          ))
      ) : (
        <GetCourseCard item={item} downloading={downloading} online={online} courseId={courseId} />
      )}
    </main>
  );
}

/* ---------- not on this phone yet — explicit, sized, never automatic ---------- */

function GetCourseCard({
  item,
  downloading,
  online,
  courseId,
}: {
  item: courseEngine.UiCourseItem | null;
  downloading: courseEngine.CourseDownloadState | undefined;
  online: boolean;
  courseId: string;
}) {
  return (
    <div className="rl-card" style={{ borderWidth: 1.5, padding: "20px 16px", textAlign: "center" }}>
      <div
        style={{
          width: 54,
          height: 54,
          borderRadius: "50%",
          background: "var(--color-canvas)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto",
          color: "var(--color-ink-subtle)",
        }}
      >
        <Icon name={online ? "download" : "no-signal"} size={24} />
      </div>
      <div style={{ fontSize: 15, fontWeight: 800, marginTop: 10 }}>
        This course isn&rsquo;t on your phone yet
      </div>
      <div
        style={{
          fontSize: 12,
          color: "var(--color-ink-subtle)",
          lineHeight: 1.5,
          marginTop: 5,
        }}
      >
        {item
          ? `It needs a connection once (${fmtBytes(item.manifestBytes)}). After that, every page works with no signal.`
          : "It needs a connection once. After that, every page works with no signal."}
      </div>
      {downloading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 14 }}>
          <Bar
            percent={downloading.pct}
            style={{ flex: 1 }}
            aria-label="Downloading this course"
          />
          <span className="rl-num" style={{ fontSize: 11.5, fontWeight: 700, color: "var(--color-primary)" }}>
            {downloading.stalled ? "kept" : `${downloading.pct}%`}
          </span>
        </div>
      ) : (
        <Button
          style={{ height: 44, padding: "0 18px", marginTop: 12, fontSize: 13, fontWeight: 800 }}
          disabled={!online}
          onClick={() => void courseEngine.downloadCourse(courseId).catch(() => undefined)}
        >
          {item ? `Get this course · ${fmtBytes(item.manifestBytes)}` : "Get this course"}
        </Button>
      )}
      {!online ? (
        <div style={{ fontSize: 11, color: "var(--color-ink-subtle)", marginTop: 8 }}>
          {copy.syncCenter.downloadStalled}
        </div>
      ) : null}
    </div>
  );
}

/* ---------- chapter rows — done / current / plain, video affordance ---------- */

function ChapterRow({
  chapter,
  manifest,
  eng,
  courseId,
  online,
}: {
  chapter: CourseManifest["chapters"][number];
  manifest: CourseManifest;
  eng: CourseEngineState;
  courseId: string;
  online: boolean;
}) {
  const progress = eng.progress[courseId] ?? {};
  const pages = [...chapter.pages].sort((a, b) => a.seq - b.seq);
  const doneCount = pages.filter((p) => progress[p.id]).length;
  const isDone = pages.length > 0 && doneCount === pages.length;

  // "You're here": the first (by seq) chapter that still has unread pages.
  const firstOpenChapter = [...manifest.chapters]
    .sort((a, b) => a.seq - b.seq)
    .find((ch) => ch.pages.some((p) => !(eng.progress[courseId] ?? {})[p.id]));
  const current = !isDone && firstOpenChapter?.id === chapter.id;

  // Trailing affordance: chapter videos not yet on this phone.
  const missingVideos = pages.filter(
    (p) => p.type === "video" && p.video && !eng.assets[p.video.assetPath],
  );
  const missingBytes = missingVideos.reduce((sum, p) => sum + (p.video?.sizeBytes ?? 0), 0);
  const dl = missingVideos
    .map((p) => (p.video ? eng.videoDownloads[p.video.assetPath] : undefined))
    .find((d) => d !== undefined);

  const targetPage = pages.find((p) => !progress[p.id]) ?? pages[0];

  const sub = isDone
    ? "Done · on this phone"
    : current
      ? `You're here · ${doneCount} of ${pages.length} pages read`
      : missingVideos.length > 0
        ? "Pages on phone · video not downloaded"
        : `${pages.length} pages · on this phone`;

  return (
    <div
      style={{
        position: "relative",
        background: "var(--color-card)",
        border: current ? "2px solid var(--color-primary)" : "1.5px solid var(--color-border)",
        borderRadius: 14,
        padding: "12px 14px",
        display: "flex",
        alignItems: "center",
        gap: 11,
      }}
    >
      {targetPage ? (
        <Link
          href={`/courses/${courseId}/read`}
          onClick={() => setReadTarget(courseId, targetPage.id)}
          aria-label={`Read chapter ${chapter.seq}: ${chapter.title}`}
          style={{ position: "absolute", inset: 0, borderRadius: 14 }}
        />
      ) : null}
      <div
        className="rl-tile"
        style={{
          width: 36,
          height: 36,
          background: isDone
            ? "var(--color-synced-bg)"
            : current
              ? "var(--color-primary-tint)"
              : "var(--color-canvas)",
          color: isDone
            ? "var(--color-synced-solid)"
            : current
              ? "var(--color-primary)"
              : "var(--color-ink-subtle)",
          fontSize: 13,
          fontWeight: 800,
        }}
      >
        {isDone ? <Icon name="check" size={16} /> : chapter.seq}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: current ? 700 : 600 }}>
          {isDone ? `${chapter.seq} · ${chapter.title}` : chapter.title}
        </div>
        <div className="rl-num" style={{ fontSize: 11, color: "var(--color-ink-subtle)", marginTop: 1 }}>
          {dl && !dl.stalled ? `${dl.pct}% · ${fmtBytes(dl.totalBytes)}` : sub}
        </div>
        {dl && !dl.stalled ? (
          <Bar percent={dl.pct} style={{ marginTop: 6 }} aria-label={`Downloading video for ${chapter.title}`} />
        ) : null}
      </div>
      <div
        style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", minHeight: 48, gap: 6 }}
      >
        {missingVideos.length > 0 && !dl ? (
          <button
            type="button"
            disabled={!online}
            aria-label={
              online
                ? `Download video for ${chapter.title} · ${fmtBytes(missingBytes)}`
                : `Download video for ${chapter.title} later — needs connection`
            }
            onClick={() => {
              for (const p of missingVideos) {
                void courseEngine.downloadVideo(courseId, p).catch(() => undefined);
              }
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              minHeight: 48,
              padding: "0 4px",
              border: "none",
              background: "none",
              fontFamily: "inherit",
              fontSize: 11,
              fontWeight: 700,
              cursor: online ? "pointer" : "default",
              color: online ? "var(--color-primary)" : "var(--color-ink-faint)",
            }}
          >
            <Icon name="download" size={12} />
            {online ? `Video · ${fmtBytes(missingBytes)}` : "Get later"}
          </button>
        ) : isDone ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              color: "var(--color-synced-fg)",
              fontSize: 11.5,
              fontWeight: 700,
            }}
          >
            <Icon name="check" size={13} />
            On phone
          </span>
        ) : null}
      </div>
    </div>
  );
}
