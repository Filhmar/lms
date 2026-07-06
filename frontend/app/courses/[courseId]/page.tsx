"use client";

/**
 * Course overview / TOC (key-screens p3b, d4 context) — chapters with
 * download/update indicators and the delta-update banner ("only changed
 * pages re-download"). Download actions simulate locally and gray out when
 * the demo says offline (the row itself never grays fully — content may
 * still be partly readable).
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Bar, Button, Chip, Icon } from "@rl/ui";
import * as copy from "@/lib/copy";
import { courses } from "@/lib/fixtures";
import { useOnline } from "@/lib/demo";
import { BackButton, science8Chapters, type Chapter } from "../course-shared";

export default function CourseTocPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const course = courses.find((c) => c.id === courseId) ?? courses[0];
  const isScience = course.id === "science-8";
  const online = useOnline();

  /* Delta-update banner (Science 8 only, per p3b). */
  const [updateState, setUpdateState] = useState<"available" | "downloading" | "done">("available");
  const [updatePct, setUpdatePct] = useState(0);
  useEffect(() => {
    if (updateState !== "downloading" || !online) return;
    const t = setInterval(() => setUpdatePct((p) => Math.min(100, p + 9)), 300);
    return () => clearInterval(t);
  }, [updateState, online]);
  const [liveMsg, setLiveMsg] = useState("");
  useEffect(() => {
    if (updatePct >= 100 && updateState === "downloading") {
      setUpdateState("done");
      setLiveMsg("Chapter 3 is up to date on this phone.");
    }
  }, [updatePct, updateState]);

  const onDevice = course.onDevice;
  const sub = isScience
    ? "8 chapters · 45 MB on this phone"
    : onDevice
      ? `${course.chapters} chapters · 24 MB on this phone`
      : `${course.chapters} chapters · not on this phone yet`;

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
          <h1 style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>{course.title}</h1>
          <div style={{ fontSize: 11.5, color: "var(--color-ink-subtle)" }}>{sub}</div>
        </div>
        {onDevice ? (
          <span className="rl-num" style={{ fontSize: 12, fontWeight: 800, color: "var(--color-primary)" }}>
            {course.progressPercent}%
          </span>
        ) : null}
      </div>

      {/* content-updated banner — delta download, sized before fetching */}
      {isScience && updateState !== "done" ? (
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
            Your division updated 2 pages in Chapter 3
          </div>
          {updateState === "downloading" ? (
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 10 }}>
              <Bar percent={updatePct} style={{ flex: 1 }} aria-label="Downloading 2 changed pages" />
              <span
                className="rl-num"
                style={{ fontSize: 11.5, fontWeight: 700, color: "var(--color-primary)" }}
              >
                {Math.round((updatePct / 100) * 380)} of 380 KB
              </span>
            </div>
          ) : (
            <>
              <Button
                size="card"
                style={{ height: 40, marginTop: 9, fontSize: 12.5, fontWeight: 800 }}
                disabled={!online}
                onClick={() => {
                  setUpdatePct(4);
                  setUpdateState("downloading");
                }}
              >
                Download 2 changed pages · 380 KB
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

      {/* chapters */}
      {isScience ? (
        science8Chapters.map((ch) => (
          <ChapterRow
            key={ch.n}
            chapter={ch}
            online={online}
            updateApplied={updateState === "done"}
            courseId={course.id}
          />
        ))
      ) : (
        <GenericChapters count={course.chapters} onDevice={onDevice} online={online} courseId={course.id} />
      )}
    </main>
  );
}

/* ---------- science chapter rows, all four designed states ---------- */

function ChapterRow({
  chapter,
  online,
  updateApplied,
  courseId,
}: {
  chapter: Chapter;
  online: boolean;
  updateApplied: boolean;
  courseId: string;
}) {
  const [dl, setDl] = useState<"idle" | "downloading" | "done">("idle");
  const [pct, setPct] = useState(0);
  useEffect(() => {
    if (dl !== "downloading" || !online) return;
    const t = setInterval(() => setPct((p) => Math.min(100, p + 6)), 350);
    return () => clearInterval(t);
  }, [dl, online]);
  useEffect(() => {
    if (pct >= 100 && dl === "downloading") setDl("done");
  }, [pct, dl]);

  const current = chapter.state === "current";
  const done = chapter.state === "done";
  const readable = done || current || chapter.state === "pages-only" || dl === "done";
  const dimmed = chapter.state === "not-downloaded" && dl !== "done";

  const sub = done
    ? "Done · on this phone"
    : current
      ? "You're here · 4 of 6 pages read"
      : chapter.state === "pages-only"
        ? dl === "done"
          ? "Pages and video on this phone"
          : "Pages on phone · video not downloaded"
        : dl === "done"
          ? "On this phone"
          : online
            ? "Not on this phone"
            : "Needs connection to download · 6 MB";

  const body = (
    <>
      <div
        className="rl-tile"
        style={{
          width: 36,
          height: 36,
          background: done ? "var(--color-synced-bg)" : current ? "var(--color-primary-tint)" : "var(--color-canvas)",
          color: done
            ? "var(--color-synced-solid)"
            : current
              ? "var(--color-primary)"
              : "var(--color-ink-subtle)",
          fontSize: 13,
          fontWeight: 800,
        }}
      >
        {done ? <Icon name="check" size={16} /> : chapter.n}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: current ? 700 : 600 }}>
          {done ? `${chapter.n} · ${chapter.title}` : chapter.title}
        </div>
        <div
          className="rl-num"
          style={{
            fontSize: 11,
            color: !online && dimmed ? "var(--color-ink-faint)" : "var(--color-ink-subtle)",
            marginTop: 1,
          }}
        >
          {dl === "downloading" ? `${Math.round(pct)}% · ${chapter.download?.size ?? ""}` : sub}
        </div>
        {dl === "downloading" ? (
          <Bar percent={pct} style={{ marginTop: 6 }} aria-label={`Downloading ${chapter.title}`} />
        ) : null}
      </div>
      <div
        style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", minHeight: 48, gap: 6 }}
      >
        {current && !updateApplied ? (
          <Chip tone="on-device" size="mini">
            2 updated
          </Chip>
        ) : null}
        {chapter.download && dl === "idle" ? (
          <button
            type="button"
            disabled={!online}
            aria-label={
              online
                ? `Download ${chapter.download.label === "Video" ? "video for" : ""} ${chapter.title} · ${chapter.download.size}`
                : `Download ${chapter.title} later — needs connection`
            }
            onClick={() => {
              setPct(3);
              setDl("downloading");
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
            {online ? `${chapter.download.label} · ${chapter.download.size}` : "Get later"}
          </button>
        ) : dl === "done" || done ? (
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
    </>
  );

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
        opacity: dimmed ? 0.8 : 1,
      }}
    >
      {readable ? (
        <Link
          href={`/courses/${courseId}/read`}
          aria-label={`Read chapter ${chapter.n}: ${chapter.title}`}
          style={{ position: "absolute", inset: 0, borderRadius: 14 }}
        />
      ) : null}
      {body}
    </div>
  );
}

/* ---------- fallback chapters for Math 8 / Filipino 8 demo links ---------- */

function GenericChapters({
  count,
  onDevice,
  online,
  courseId,
}: {
  count: number;
  onDevice: boolean;
  online: boolean;
  courseId: string;
}) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => i + 1).map((n) => (
        <div
          key={n}
          style={{
            position: "relative",
            background: "var(--color-card)",
            border: "1.5px solid var(--color-border)",
            borderRadius: 14,
            padding: "12px 14px",
            display: "flex",
            alignItems: "center",
            gap: 11,
            opacity: onDevice ? 1 : 0.8,
          }}
        >
          {onDevice ? (
            <Link
              href={`/courses/${courseId}/read`}
              aria-label={`Read chapter ${n}`}
              style={{ position: "absolute", inset: 0, borderRadius: 14 }}
            />
          ) : null}
          <div
            className="rl-tile rl-tile--canvas"
            style={{ width: 36, height: 36, fontSize: 13, fontWeight: 800 }}
          >
            {n}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Chapter {n}</div>
            <div style={{ fontSize: 11, color: "var(--color-ink-subtle)", marginTop: 1 }}>
              {onDevice ? "On this phone" : online ? "Not on this phone" : "Needs connection to download"}
            </div>
          </div>
          {onDevice ? (
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
      ))}
    </>
  );
}
