"use client";

/**
 * My courses (key-screens p3a) — REAL: GET /courses drives the list (the
 * on-device manifests are the calm fallback when the fetch fails), per-course
 * on-device state comes from IndexedDB, progress % from local ∪ server
 * completions, and the sync pill reads the real shared outbox. States kept
 * from the design: on-phone + progress / not-downloaded (muted icon) /
 * offline "Get later"; data saver stays a visible local preference.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bar, Icon, SyncPill, type WorkState } from "@rl/ui";
import { AppShell } from "@/components/app-chrome";
import * as copy from "@/lib/copy";
import { RequireAuth } from "@/lib/session";
import * as courseEngine from "@/lib/course/engine";
import { completedCount, type UiCourseItem } from "@/lib/course/engine";
import { useCourseEngine } from "@/lib/course/use-engine";
import { strings } from "../exams/state";
import { fmtBytes, useDataSaver } from "./course-shared";

export default function CoursesPage() {
  return (
    <RequireAuth>
      <CoursesScreen />
    </RequireAuth>
  );
}

function CoursesScreen() {
  const eng = useCourseEngine();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "on-phone">("all");
  const [dataSaver] = useDataSaver();

  const online = eng.online;
  const [liveMsg, setLiveMsg] = useState("");
  const firstStatus = useRef(true);
  useEffect(() => {
    if (!eng.ready) return;
    if (firstStatus.current) {
      firstStatus.current = false;
      return;
    }
    setLiveMsg(online ? copy.syncCenter.pillAllClear : copy.environment.offline);
  }, [online, eng.ready]);

  if (!eng.ready) return null;

  const pending = eng.outbox.pending;
  const pillState: WorkState =
    pending === 0 ? "synced" : online ? "sending" : "on-device";
  const pillLabel =
    pillState === "synced"
      ? copy.syncCenter.pillAllClear
      : pillState === "sending"
        ? strings.sendingLeft(pending)
        : copy.syncCenter.pillResting(pending);

  const visible = eng.courses.filter(
    (c) =>
      c.title.toLowerCase().includes(query.trim().toLowerCase()) &&
      (filter === "all" || Boolean(eng.manifests[c.id])),
  );

  return (
    <AppShell>
      <span
        aria-live="polite"
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}
      >
        {liveMsg}
      </span>
      <div className="page-body" style={{ padding: 16 }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h1 style={{ flex: 1, fontSize: 19, fontWeight: 800, margin: 0 }}>Courses</h1>
          <Link href="/sync" aria-label="Open Sync Center" style={{ textDecoration: "none" }}>
            <SyncPill state={pillState} label={pillLabel} offline={!online} />
          </Link>
        </div>

        {/* search */}
        <input
          className="rl-input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your courses…"
          aria-label="Search your courses"
          style={{ height: 44, borderRadius: 999, fontSize: 13.5, padding: "0 16px" }}
        />

        {/* filter chips */}
        <div style={{ display: "flex", gap: 8 }} role="group" aria-label="Filter courses">
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
            All
          </FilterChip>
          <FilterChip active={filter === "on-phone"} onClick={() => setFilter("on-phone")}>
            On this phone
          </FilterChip>
        </div>

        {/* data saver — environment signal, informational amber */}
        {dataSaver ? (
          <div
            style={{
              background: "var(--color-on-device-bg)",
              borderRadius: 12,
              padding: "9px 13px",
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
            }}
          >
            <span style={{ color: "var(--color-on-device-fg)", display: "inline-flex", marginTop: 1 }}>
              <Icon name="download" size={14} />
            </span>
            <span style={{ fontSize: 11.5, fontWeight: 600, lineHeight: 1.45, color: "var(--color-on-device-fg)" }}>
              Data saver is on — pages load when you tap, nothing downloads by itself.
            </span>
          </div>
        ) : null}

        {eng.courses.length === 0 ? (
          <div
            style={{
              border: "1.5px dashed var(--color-border)",
              borderRadius: 14,
              padding: "16px 14px",
              fontSize: 12.5,
              lineHeight: 1.5,
              color: "var(--color-ink-subtle)",
              textAlign: "center",
            }}
          >
            {online
              ? "No courses yet — courses from your school will show up here."
              : "You’re offline — courses on this phone still work."}
          </div>
        ) : null}

        {visible.map((c) => (
          <CourseCardRow key={c.id} course={c} eng={eng} online={online} />
        ))}
      </div>
    </AppShell>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        borderRadius: 999,
        padding: "8px 15px",
        fontSize: 12,
        fontWeight: 700,
        fontFamily: "inherit",
        cursor: "pointer",
        minHeight: 36,
        background: active ? "var(--color-primary)" : "var(--color-card)",
        color: active ? "var(--color-on-primary)" : "var(--color-ink-secondary)",
        border: active ? "1.5px solid var(--color-primary)" : "1.5px solid var(--color-border)",
      }}
    >
      {children}
    </button>
  );
}

function CourseCardRow({
  course,
  eng,
  online,
}: {
  course: UiCourseItem;
  eng: courseEngine.CourseEngineState;
  online: boolean;
}) {
  const stored = Boolean(eng.manifests[course.id]);
  const downloading = eng.downloads[course.id];
  const muted = !stored && !downloading;

  const done = stored
    ? Math.max(completedCount(course.id, eng), course.completedPages)
    : course.completedPages;
  const percent =
    course.totalPages > 0 ? Math.round((done / course.totalPages) * 100) : 0;

  const sub = stored
    ? `${course.subject} · ${course.chapters} chapters`
    : online
      ? "Not on this phone yet"
      : `Needs connection to download · ${fmtBytes(course.manifestBytes)}`;

  return (
    <div
      style={{
        position: "relative",
        background: "var(--color-card)",
        border: "1.5px solid var(--color-border)",
        borderRadius: 14,
        padding: "13px 14px",
      }}
    >
      <Link
        href={`/courses/${course.id}`}
        aria-label={`Open ${course.title}`}
        style={{ position: "absolute", inset: 0, borderRadius: 14 }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <div
          className={`rl-tile ${muted ? "rl-tile--canvas" : "rl-tile--tint"}`}
          style={{ width: 44, height: 44 }}
        >
          <Icon name="course" size={19} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{course.title}</div>
          <div
            style={{
              fontSize: 11.5,
              color: !online && muted ? "var(--color-ink-faint)" : "var(--color-ink-subtle)",
              marginTop: 1,
            }}
          >
            {sub}
          </div>
        </div>
        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", minHeight: 48 }}>
          {stored ? (
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
          ) : downloading ? (
            <span
              className="rl-num"
              style={{ fontSize: 11.5, fontWeight: 700, color: downloading.stalled ? "var(--color-on-device-fg)" : "var(--color-primary)" }}
            >
              {downloading.stalled ? "Kept — waiting for signal" : `Getting… ${downloading.pct}%`}
            </span>
          ) : (
            <button
              type="button"
              disabled={!online}
              onClick={() => void courseEngine.downloadCourse(course.id).catch(() => undefined)}
              aria-label={
                online
                  ? `Download ${course.title} · ${fmtBytes(course.manifestBytes)}`
                  : `Download ${course.title} later — needs connection`
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                minHeight: 48,
                padding: "0 4px",
                border: "none",
                background: "none",
                fontFamily: "inherit",
                fontSize: 11.5,
                fontWeight: 700,
                cursor: online ? "pointer" : "default",
                color: online ? "var(--color-primary)" : "var(--color-ink-faint)",
              }}
            >
              <Icon name="download" size={13} />
              {online ? `Get · ${fmtBytes(course.manifestBytes)}` : "Get later"}
            </button>
          )}
        </div>
      </div>
      {stored && course.totalPages > 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 10 }}>
          <Bar
            percent={percent}
            style={{ flex: 1 }}
            aria-label={`${course.title} — ${percent}% done`}
          />
          <span
            className="rl-num"
            style={{ fontSize: 11, fontWeight: 700, color: "var(--color-ink-subtle)" }}
          >
            {percent}%
          </span>
        </div>
      ) : null}
    </div>
  );
}
