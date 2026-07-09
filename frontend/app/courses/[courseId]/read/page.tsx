"use client";

/**
 * Course player (key-screens p3c, deep-dives d4a–d4e) — REAL: pages render
 * from the stored manifest (IndexedDB) in reading order across chapters,
 * markdown bodies go through the minimal safe renderer, page completions
 * write locally + enqueue LWW progress events in the shared outbox, and the
 * Next button's prefetch bead is honest: green when the next page needs no
 * network (text / downloaded video), hollow otherwise. Video plays from the
 * stored blob (object URL); a non-decodable asset falls into the calm
 * "Video isn't ready yet" state — never a broken player.
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Bar, Button, Chip, Icon } from "@rl/ui";
import * as copy from "@/lib/copy";
import { RequireAuth } from "@/lib/session";
import * as courseEngine from "@/lib/course/engine";
import {
  completedCount,
  courseVideoBytes,
  flattenPages,
  manifestBytesOf,
  type CourseEngineState,
  type FlatPage,
} from "@/lib/course/engine";
import { useCourseEngine } from "@/lib/course/use-engine";
import { Markdown } from "@/lib/course/md";
import type { CourseManifest, CoursePage } from "@rl/schemas";
import {
  BackButton,
  Chevron,
  fmtBytes,
  setExamTarget,
  takeReadTarget,
  useDataSaver,
} from "../../course-shared";

type Avail = "none" | "ready";

export default function PlayerPage() {
  return (
    <RequireAuth>
      <PlayerScreen />
    </RequireAuth>
  );
}

function PlayerScreen() {
  const { courseId } = useParams<{ courseId: string }>();
  const eng = useCourseEngine();
  const online = eng.online;

  const stored = eng.manifests[courseId] ?? null;
  const manifest = stored?.manifest ?? null;
  const flat = useMemo(() => (manifest ? flattenPages(manifest) : []), [manifest]);

  const [pageId, setPageId] = useState<string | null>(null);
  const [tocOpen, setTocOpen] = useState(false);
  const [isWide, setIsWide] = useState(false);
  /** `t` hides/shows the docked rail at ≥720px (KEYS spec, lrn-b). */
  const [railHidden, setRailHidden] = useState(false);
  const [liveMsg, setLiveMsg] = useState("");

  const contentRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  /* reading keyboard: ←/→ pages · t TOC rail · Space video. The handler
     lives in a ref because prev/next only exist after the manifest loads. */
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ----- opening page: the TOC handoff, else the first unread page ----- */
  useEffect(() => {
    if (!manifest || flat.length === 0 || pageId !== null) return;
    const handoff = takeReadTarget(courseId);
    if (handoff && flat.some((f) => f.page.id === handoff)) {
      setPageId(handoff);
      return;
    }
    const done = courseEngine.getCourseEngineState().progress[courseId] ?? {};
    const firstUnread = flat.find((f) => !done[f.page.id]);
    setPageId((firstUnread ?? flat[0]!).page.id);
  }, [manifest, flat, pageId, courseId]);

  /* ----- ≥720px: the TOC sheet docks as a rail; nothing else forks ----- */
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 720px)");
    const update = () => setIsWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  /* ----- environment announcements ----- */
  const firstStatus = useRef(true);
  useEffect(() => {
    if (firstStatus.current) {
      firstStatus.current = false;
      return;
    }
    if (!online) setLiveMsg(copy.environment.offline);
  }, [online]);

  /* ----- sheet: Esc closes, focus moves in ----- */
  useEffect(() => {
    if (!tocOpen) return;
    sheetRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTocOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tocOpen]);

  if (!eng.ready) return null;

  /* ----- course not on this phone yet — d4c grammar, course-level ----- */
  if (!manifest) {
    const item = eng.courses.find((c) => c.id === courseId) ?? null;
    const downloading = eng.downloads[courseId];
    return (
      <div className="plyr-root">
        <style>{playerCss}</style>
        <div className="plyr-main">
          <div className="plyr-chrome">
            <BackButton href={`/courses/${courseId}`} label="Back to course contents" size={40} iconSize={18} />
            <div className="plyr-context" style={{ cursor: "default" }}>
              <span className="plyr-crumb">{item?.title ?? "Course"}</span>
              <span className="plyr-page-title">Reader</span>
            </div>
            {!online ? (
              <Chip tone="on-device" size="mini" icon={<Icon name="phone-check" size={11} />}>
                Offline
              </Chip>
            ) : null}
          </div>
          <div className="plyr-content">
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
              <div style={{ fontSize: 12, color: "var(--color-ink-subtle)", lineHeight: 1.5, marginTop: 5 }}>
                It needs a connection once
                {item ? ` (${fmtBytes(item.manifestBytes)})` : ""}. Everything you&rsquo;ve
                downloaded still works.
              </div>
              {downloading ? (
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 14 }}>
                  <Bar percent={downloading.pct} style={{ flex: 1 }} aria-label="Downloading this course" />
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
          </div>
        </div>
      </div>
    );
  }

  const current =
    flat.find((f) => f.page.id === pageId) ?? flat[0] ?? null;
  if (!current) return null;

  const next = flat[current.globalIndex + 1] ?? null;
  const prev = flat[current.globalIndex - 1] ?? null;

  /** Honest bead: local once the manifest is stored, except undownloaded video. */
  const availOf = (f: FlatPage): Avail =>
    f.page.type === "video" && f.page.video && !eng.assets[f.page.video.assetPath]
      ? "none"
      : "ready";
  const nextBead: Avail | "end" = next ? availOf(next) : "end";

  const goTo = (id: string) => {
    setPageId(id);
    setTocOpen(false);
    contentRef.current?.scrollIntoView({ block: "start" });
  };

  const goNext = () => {
    if (!next) return;
    // Page-complete fires on Next: local write + outbox enqueue, atomically.
    void courseEngine.markPageComplete(courseId, current.page.id);
    goTo(next.page.id);
  };

  keyHandler.current = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (e.key === "ArrowLeft") {
      if (prev) {
        e.preventDefault();
        goTo(prev.page.id);
      }
    } else if (e.key === "ArrowRight") {
      if (next) {
        e.preventDefault();
        goNext();
      }
    } else if ((e.key === "t" || e.key === "T") && isWide) {
      e.preventDefault();
      setRailHidden((h) => !h);
    } else if (e.key === " " && !(t instanceof HTMLButtonElement) && !(t instanceof HTMLAnchorElement)) {
      const video = contentRef.current?.querySelector("video");
      if (video && !(t instanceof HTMLVideoElement)) {
        e.preventDefault();
        if (video.paused) void video.play();
        else video.pause();
      }
    }
  };

  return (
    <div className="plyr-root">
      <style>{playerCss}</style>
      <span className="plyr-vh" aria-live="polite">
        {liveMsg}
      </span>

      {/* ----- docked TOC rail (≥720px, d4e); `t` hides it (lrn-b) ----- */}
      {isWide && !railHidden ? (
        <nav className="plyr-rail" aria-label="Chapters and pages">
          <TocPanel
            manifest={manifest}
            eng={eng}
            courseId={courseId}
            currentPageId={current.page.id}
            onGo={goTo}
          />
          <div
            style={{
              marginTop: 8,
              fontSize: 10.5,
              color: "var(--color-ink-subtle)",
              padding: "0 6px",
            }}
          >
            press <kbd className="rl-kbd">t</kbd> to hide
          </div>
        </nav>
      ) : null}

      <div className="plyr-main">
        {/* ----- sticky context bar — tap anywhere on it opens the TOC ----- */}
        <div className="plyr-chrome">
          <BackButton href={`/courses/${courseId}`} label="Back to course contents" size={40} iconSize={18} />
          <button
            type="button"
            className="plyr-context"
            onClick={() => {
              if (!isWide) setTocOpen(true);
              else setRailHidden((h) => !h); // pointer equivalent of `t`
            }}
            aria-label="Open chapters and pages"
            aria-haspopup="dialog"
          >
            <span className="plyr-crumb">
              Ch. {current.chapterSeq} · {current.chapterTitle}
            </span>
            <span className="plyr-page-title rl-num">
              Page {current.indexInChapter + 1} of {current.chapterPageCount} — {current.page.title}
            </span>
          </button>
          {!online ? (
            <Chip tone="on-device" size="mini" icon={<Icon name="phone-check" size={11} />}>
              Offline
            </Chip>
          ) : null}
        </div>

        {/* ----- reading column ----- */}
        <div className="plyr-content" ref={contentRef}>
          {current.page.type === "text_content" ? (
            <Markdown source={current.page.body ?? ""} />
          ) : current.page.type === "video" ? (
            <>
              <h1 style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.3, margin: 0 }}>
                {current.page.title}
              </h1>
              {eng.storageFull ? (
                <div
                  style={{
                    background: "var(--color-on-device-bg)",
                    border: "1.5px solid var(--color-warning-border)",
                    borderRadius: 14,
                    padding: "11px 13px",
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <span style={{ color: "var(--color-on-device-fg)", display: "inline-flex", flexShrink: 0 }}>
                    <Icon name="attention" size={15} />
                  </span>
                  <span
                    style={{ flex: 1, fontSize: 12, lineHeight: 1.45, color: "var(--color-on-device-fg)", fontWeight: 600 }}
                  >
                    {copy.environment.storageFull}
                  </span>
                  <Link
                    href="/downloads"
                    style={{ fontSize: 12, fontWeight: 800, color: "var(--color-primary)", textDecoration: "none" }}
                  >
                    Free up
                  </Link>
                </div>
              ) : null}
              <VideoBlock
                courseId={courseId}
                page={current.page}
                eng={eng}
                online={online}
                onAnnounce={setLiveMsg}
              />
            </>
          ) : (
            <AssessmentBlock page={current.page} eng={eng} />
          )}
        </div>

        {/* ----- sticky pager — prefetch bead on Next ----- */}
        <div className="plyr-pager">
          <button
            type="button"
            className="plyr-prev"
            disabled={!prev}
            onClick={() => prev && goTo(prev.page.id)}
          >
            <Chevron size={15} dir="left" />
            Previous
          </button>
          <button
            type="button"
            className="rl-btn rl-btn--primary plyr-next"
            disabled={nextBead === "end"}
            onClick={goNext}
          >
            <PrefetchBead status={nextBead === "end" ? "none" : nextBead} />
            {nextBead === "ready" ? "Next — ready" : "Next"}
          </button>
        </div>
      </div>

      {/* ----- TOC bottom sheet (mobile) ----- */}
      {tocOpen && !isWide ? (
        <>
          <div className="scrim" onClick={() => setTocOpen(false)} aria-hidden />
          <div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Chapters and pages"
            ref={sheetRef}
            tabIndex={-1}
          >
            <div className="sheet__grabber" />
            <TocPanel
              manifest={manifest}
              eng={eng}
              courseId={courseId}
              currentPageId={current.page.id}
              onGo={goTo}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

/* =============== TOC — same component in sheet and rail (d4e) =============== */

function TocPanel({
  manifest,
  eng,
  courseId,
  currentPageId,
  onGo,
}: {
  manifest: CourseManifest;
  eng: CourseEngineState;
  courseId: string;
  currentPageId: string;
  onGo: (pageId: string) => void;
}) {
  const progress = eng.progress[courseId] ?? {};
  const chapters = [...manifest.chapters].sort((a, b) => a.seq - b.seq);
  const currentChapter = chapters.find((ch) =>
    ch.pages.some((p) => p.id === currentPageId),
  );
  const stored = eng.manifests[courseId];
  const onDeviceBytes = stored
    ? manifestBytesOf(stored) + courseVideoBytes(courseId, eng)
    : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minHeight: 0 }}>
      <div style={{ fontSize: 14, fontWeight: 800, padding: "0 6px 8px" }}>{manifest.title}</div>

      {chapters.map((chapter) => {
        const pages = [...chapter.pages].sort((a, b) => a.seq - b.seq);
        const done = pages.length > 0 && pages.every((p) => progress[p.id]);
        const missingVideoBytes = pages
          .filter((p) => p.type === "video" && p.video && !eng.assets[p.video.assetPath])
          .reduce((sum, p) => sum + (p.video?.sizeBytes ?? 0), 0);

        if (chapter.id !== currentChapter?.id) {
          return (
            <TocChapterRow
              key={chapter.id}
              label={`${chapter.seq} · ${chapter.title}`}
              done={done}
              download={missingVideoBytes > 0 ? fmtBytes(missingVideoBytes) : undefined}
            />
          );
        }

        /* expanded current chapter */
        return (
          <div
            key={chapter.id}
            style={{ background: "var(--color-primary-tint)", borderRadius: 9, padding: "8px 9px" }}
          >
            <div style={{ fontSize: 12, fontWeight: 800, color: "var(--color-primary)" }}>
              {chapter.seq} · {chapter.title}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 1, marginTop: 4 }}>
              {pages.map((p, i) => {
                const isCurrent = p.id === currentPageId;
                const hollow =
                  p.type === "video" && p.video && !eng.assets[p.video.assetPath];
                const isDone = Boolean(progress[p.id]);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onGo(p.id)}
                    aria-current={isCurrent ? "page" : undefined}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      fontSize: 11.5,
                      fontFamily: "inherit",
                      textAlign: "left",
                      padding: "7px 8px",
                      minHeight: 30,
                      border: "none",
                      cursor: "pointer",
                      borderRadius: 6,
                      fontWeight: isCurrent ? 800 : 500,
                      color: isCurrent ? "var(--color-primary)" : "var(--color-ink-secondary)",
                      background: isCurrent ? "var(--color-card)" : "transparent",
                    }}
                  >
                    <span>
                      {i + 1} · {p.title}
                    </span>
                    {hollow ? (
                      <span
                        title="Not on this phone yet"
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          border: "1.5px solid #A9B6CF",
                          flexShrink: 0,
                        }}
                      />
                    ) : isDone ? (
                      <span style={{ color: "var(--color-synced-solid)", display: "inline-flex" }}>
                        <Icon name="check" size={11} />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      <div
        style={{
          marginTop: "auto",
          background: "var(--color-canvas)",
          borderRadius: 9,
          padding: "8px 10px",
          fontSize: 10.5,
          color: "var(--color-ink-subtle)",
          lineHeight: 1.5,
        }}
      >
        Course: {fmtBytes(onDeviceBytes)} on device ·{" "}
        <Link href="/downloads" style={{ color: "var(--color-primary)", fontWeight: 700 }}>
          manage in Downloads
        </Link>
      </div>
    </div>
  );
}

function TocChapterRow({
  label,
  done,
  download,
}: {
  label: string;
  done?: boolean;
  download?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        padding: "8px 9px",
        borderRadius: 9,
        fontSize: 12,
        fontWeight: 600,
        color: "var(--color-ink-secondary)",
      }}
    >
      <span>{label}</span>
      {done ? (
        <span style={{ color: "var(--color-synced-solid)", display: "inline-flex" }} title="Done">
          <Icon name="check" size={13} />
        </span>
      ) : download ? (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            color: "var(--color-primary)",
            fontSize: 10.5,
            fontWeight: 700,
          }}
        >
          <Icon name="download" size={11} />
          {download}
        </span>
      ) : null}
    </div>
  );
}

/* =============== video block — the designed states, driven by real data ===============
   on-device (object URL, scrub instantly) / downloading (byte-true) /
   not-downloaded offline / not-downloaded online (data-saver aware) /
   "isn't ready yet" when the stored asset can't decode. */

function VideoBlock({
  courseId,
  page,
  eng,
  online,
  onAnnounce,
}: {
  courseId: string;
  page: CoursePage;
  eng: CourseEngineState;
  online: boolean;
  onAnnounce: (msg: string) => void;
}) {
  const video = page.video;
  const assetPath = video?.assetPath ?? "";
  const storedMeta = assetPath ? eng.assets[assetPath] : undefined;
  const dl = assetPath ? eng.videoDownloads[assetPath] : undefined;
  const [dataSaver] = useDataSaver();

  const [src, setSrc] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);

  /* stored blob → object URL (revoked on page change/unmount) */
  useEffect(() => {
    setBroken(false);
    setSrc(null);
    if (!storedMeta || !assetPath) return;
    let url: string | null = null;
    let cancelled = false;
    void courseEngine.getVideoBlob(assetPath).then((blob) => {
      if (cancelled || !blob) return;
      url = URL.createObjectURL(blob);
      setSrc(url);
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [assetPath, storedMeta]);

  if (!video) return null;
  const sizeLabel = fmtBytes(storedMeta?.sizeBytes ?? video.sizeBytes);

  const removeLink = (
    <button
      type="button"
      onClick={() => void courseEngine.removeVideo(assetPath)}
      aria-label={`Remove this video from your phone · frees ${sizeLabel}`}
      style={{
        border: "none",
        background: "none",
        fontFamily: "inherit",
        fontSize: 10.5,
        color: "#93A3C4",
        textDecoration: "underline",
        cursor: "pointer",
        padding: "6px 2px",
      }}
    >
      Remove
    </button>
  );

  if (storedMeta && broken) {
    /* stored but not decodable (placeholder media) — calm, never broken */
    return (
      <div
        style={{
          background: "var(--color-card)",
          border: "1.5px dashed var(--color-border-strong)",
          borderRadius: 14,
          padding: 14,
          display: "flex",
          gap: 12,
          alignItems: "flex-start",
        }}
      >
        <span style={{ color: "var(--color-ink-subtle)", display: "inline-flex", marginTop: 2 }}>
          <Icon name="course" size={20} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-ink-secondary)" }}>
            Video isn&rsquo;t ready yet
          </div>
          <div style={{ fontSize: 11, color: "var(--color-ink-subtle)", marginTop: 2, lineHeight: 1.45 }}>
            Your school is still preparing it — check back another day. Everything else on this
            page still works.
          </div>
          <div className="rl-num" style={{ fontSize: 10.5, color: "var(--color-ink-subtle)", marginTop: 6 }}>
            {sizeLabel} ·{" "}
            <button
              type="button"
              onClick={() => void courseEngine.removeVideo(assetPath)}
              aria-label={`Remove this video from your phone · frees ${sizeLabel}`}
              style={{
                border: "none",
                background: "none",
                fontFamily: "inherit",
                fontSize: 10.5,
                color: "var(--color-ink-subtle)",
                textDecoration: "underline",
                cursor: "pointer",
                padding: "4px 2px",
              }}
            >
              Remove
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (storedMeta) {
    /* d4b state 1 — on this phone */
    return (
      <div style={{ background: "#0F1526", borderRadius: 14, overflow: "hidden" }}>
        <div
          style={{
            position: "relative",
            background:
              "repeating-linear-gradient(45deg,#131C31,#131C31 10px,#0F1526 10px,#0F1526 20px)",
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 9,
              left: 10,
              zIndex: 1,
              fontSize: 9,
              fontFamily: "ui-monospace, Menlo, monospace",
              color: "#93A3C4",
              pointerEvents: "none",
            }}
          >
            video: {page.title.toLowerCase()} · {video.durationLabel}
          </span>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption -- captions arrive with the media pipeline */}
          <video
            controls
            preload="metadata"
            src={src ?? undefined}
            onError={() => setBroken(true)}
            aria-label={`Video: ${page.title}`}
            style={{ display: "block", width: "100%", height: 180, background: "transparent" }}
          />
        </div>
        <div style={{ background: "#131C31", padding: "9px 12px", display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              color: "#57D07A",
              fontSize: 10.5,
              fontWeight: 700,
              flex: 1,
            }}
          >
            <Icon name="check" size={12} />
            On this phone — scrub instantly
          </span>
          <span className="rl-num" style={{ fontSize: 10.5, color: "#93A3C4" }}>
            {sizeLabel} · {removeLink}
          </span>
        </div>
      </div>
    );
  }

  if (dl) {
    /* d4b state 3 — downloading (stalls calmly when the signal drops) */
    const stalled = dl.stalled || !online;
    return (
      <div className="plyr-dl-card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            fontSize: 12.5,
            fontWeight: 700,
            color: stalled ? "var(--color-on-device-fg)" : "var(--color-primary)",
          }}
        >
          <span>{page.title}</span>
          <span className="rl-num">
            {dl.pct}% {stalled ? "kept" : `· ${fmtBytes(dl.totalBytes)}`}
          </span>
        </div>
        <div
          style={{
            height: 6,
            background: "var(--color-primary-tint)",
            borderRadius: 3,
            marginTop: 7,
            overflow: "hidden",
          }}
          role="progressbar"
          aria-valuenow={dl.pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Video download"
        >
          <div
            style={{
              width: `${dl.pct}%`,
              height: "100%",
              background: stalled ? "var(--color-on-device-solid)" : "var(--color-primary)",
              borderRadius: 3,
            }}
          />
        </div>
        {stalled ? (
          <div
            style={{
              display: "flex",
              gap: 6,
              alignItems: "center",
              fontSize: 11,
              color: "var(--color-on-device-fg)",
              fontWeight: 600,
              marginTop: 7,
            }}
          >
            <Icon name="no-signal" size={12} />
            {copy.syncCenter.downloadStalled}
          </div>
        ) : null}
      </div>
    );
  }

  if (!online) {
    /* d4b state 2 — explicit, sized */
    return (
      <div
        style={{
          background: "var(--color-card)",
          border: "1.5px dashed var(--color-border-strong)",
          borderRadius: 14,
          padding: 14,
          display: "flex",
          gap: 12,
          alignItems: "flex-start",
        }}
      >
        <span style={{ color: "var(--color-ink-subtle)", display: "inline-flex", marginTop: 2 }}>
          <Icon name="no-signal" size={20} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-ink-secondary)" }}>
            Not available offline
          </div>
          <div style={{ fontSize: 11, color: "var(--color-ink-subtle)", marginTop: 2, lineHeight: 1.45 }}>
            Connect to download — the rest of the course still works.
          </div>
        </div>
        <span
          aria-disabled="true"
          style={{
            height: 38,
            padding: "0 13px",
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            background: "var(--color-canvas)",
            color: "var(--color-ink-faint)",
            borderRadius: 999,
            fontSize: 11.5,
            fontWeight: 800,
            flexShrink: 0,
          }}
        >
          Get · {sizeLabel}
        </span>
      </div>
    );
  }

  /* d4b state 4 — online, not downloaded: data-saver aware, always explicit */
  return (
    <div
      style={{
        background: "var(--color-card)",
        border: dataSaver ? "1.5px solid var(--color-warning-border)" : "1.5px solid var(--color-border)",
        borderRadius: 14,
        padding: 14,
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
      }}
    >
      <span
        style={{
          color: dataSaver ? "var(--color-on-device-fg)" : "var(--color-primary)",
          display: "inline-flex",
          marginTop: 2,
        }}
      >
        <Icon name="download" size={18} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: dataSaver ? "var(--color-on-device-fg)" : "var(--color-ink)",
          }}
        >
          {dataSaver ? "Data saver is on" : "Video not on this phone yet"}
        </div>
        <div style={{ fontSize: 11, color: "var(--color-ink-subtle)", marginTop: 2, lineHeight: 1.45 }}>
          Downloading uses ~{sizeLabel} of data once. After that it plays with no signal.
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          void courseEngine
            .downloadVideo(courseId, page)
            .then(() => onAnnounce("Video is on this phone — scrub instantly."))
            .catch(() => undefined);
        }}
        style={{
          height: 38,
          padding: "0 13px",
          border: "1.5px solid var(--color-border)",
          color: "var(--color-ink-secondary)",
          background: "var(--color-card)",
          borderRadius: 999,
          fontSize: 11.5,
          fontWeight: 800,
          fontFamily: "inherit",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        Get · {sizeLabel}
      </button>
    </div>
  );
}

/* =============== assessment embed — links into the REAL exam journey =============== */

function AssessmentBlock({
  page,
  eng,
}: {
  page: CoursePage;
  eng: CourseEngineState;
}) {
  const examReady = page.examId !== null && eng.storedExamIds.includes(page.examId);
  return (
    <>
      <div className="rl-overline">Chapter check</div>
      <h1 style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.3, margin: 0 }}>{page.title}</h1>
      <div className="rl-card" style={{ borderWidth: 1.5, padding: "14px 15px" }}>
        <div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
          <div className="rl-tile rl-tile--tint" style={{ width: 40, height: 40 }}>
            <Icon name="clock" size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>This one counts</div>
            <div style={{ fontSize: 12, color: "var(--color-ink-subtle)", lineHeight: 1.5, marginTop: 2 }}>
              {examReady
                ? copy.exam.ready
                : "It opens in Exams — download it there once, then it works with no signal."}
            </div>
          </div>
        </div>
        {examReady ? (
          <div style={{ marginTop: 10 }}>
            <Chip tone="synced" size="compact" icon={<Icon name="phone-check" size={12} />}>
              Ready on this phone — works with no signal
            </Chip>
          </div>
        ) : null}
        <Link
          href="/exams"
          onClick={() => {
            if (page.examId) setExamTarget(page.examId);
          }}
          className="rl-btn rl-btn--primary"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: 44,
            marginTop: 12,
            fontSize: 13.5,
            fontWeight: 800,
            textDecoration: "none",
          }}
        >
          Open the exam
        </Link>
      </div>
    </>
  );
}

/* =============== prefetch bead — shape-redundant grammar =============== */

function PrefetchBead({ status }: { status: Avail }) {
  if (status === "ready") {
    return (
      <span
        aria-hidden
        style={{
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: "var(--color-synced-solid)",
          border: "2px solid rgba(255,255,255,0.65)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          boxSizing: "content-box",
        }}
      >
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M5 12.5l4.7 4.7L19.5 7"
            stroke="#ffffff"
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  return (
    <span
      aria-hidden
      style={{
        width: 14,
        height: 14,
        borderRadius: "50%",
        border: "2px solid rgba(255,255,255,0.55)",
        flexShrink: 0,
        boxSizing: "border-box",
      }}
    />
  );
}

/* =============== styles — single fork at ≥720px =============== */

const playerCss = `
.plyr-vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;}
.plyr-root{display:flex;min-height:100dvh;}
.plyr-rail{display:none;}
.plyr-main{flex:1;display:flex;flex-direction:column;max-width:480px;margin:0 auto;width:100%;min-height:100dvh;}
.plyr-chrome{position:sticky;top:0;z-index:10;background:var(--color-canvas);display:flex;align-items:center;gap:9px;padding:12px 14px 8px;}
.plyr-context{flex:1;min-width:0;border:none;background:none;font-family:inherit;text-align:left;cursor:pointer;padding:4px 2px;min-height:44px;}
.plyr-crumb{display:block;font-size:11px;color:var(--color-ink-subtle);font-weight:600;}
.plyr-page-title{display:block;font-size:14px;font-weight:700;color:var(--color-ink);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.plyr-content{flex:1;display:flex;flex-direction:column;gap:12px;padding:6px 16px 12px;width:100%;}
.plyr-pager{position:sticky;bottom:0;z-index:10;background:var(--color-card);box-shadow:0 -1px 0 var(--color-border);padding:11px 14px 13px;display:flex;gap:9px;width:100%;}
.plyr-prev{flex:1;height:48px;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1.5px solid var(--color-border);border-radius:999px;font-size:13.5px;font-weight:700;color:var(--color-ink-secondary);background:var(--color-card);font-family:inherit;cursor:pointer;}
.plyr-prev:disabled{opacity:0.5;cursor:default;}
.plyr-next{flex:1.3;height:48px;font-size:14px;font-weight:800;}
.plyr-dl-card{background:var(--color-card);border:1.5px solid #ADC4F5;border-radius:14px;padding:12px 14px;}
[data-theme="dark"] .plyr-dl-card{border-color:#2C4270;}
@media (min-width:720px){
  .plyr-rail{display:flex;flex-direction:column;width:236px;flex-shrink:0;background:var(--color-card);border-right:1px solid var(--color-border);padding:14px 12px;position:sticky;top:0;height:100dvh;overflow:auto;}
  .plyr-main{max-width:none;margin:0;}
  .plyr-chrome{padding:13px 20px 8px;}
  .plyr-content{max-width:520px;padding:4px 20px 14px;}
  .plyr-pager{max-width:520px;padding:11px 20px 16px;}
}
/* Desktop (lrn-b): 250px rail, reading measure ~68ch centered, pager aligned */
@media (min-width:1080px){
  .plyr-rail{width:250px;padding:16px 12px;}
  .plyr-chrome{padding:14px 24px 8px;}
  .plyr-content{max-width:688px;width:100%;margin:0 auto;padding:6px 24px 16px;}
  .plyr-pager{max-width:688px;width:100%;margin:0 auto;padding:12px 24px 16px;}
}
`;
