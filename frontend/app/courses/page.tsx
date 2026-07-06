"use client";

/**
 * My courses (key-screens p3a) — per-course download state, data saver
 * visible. States: downloaded + progress / downloaded-with-update (amber) /
 * not-downloaded (muted icon). All data local; the sync pill and download
 * actions react to the demo connectivity.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bar, Chip, Icon, SyncPill } from "@rl/ui";
import { AppShell } from "@/components/app-chrome";
import * as copy from "@/lib/copy";
import { useOnline } from "@/lib/demo";

interface CourseCard {
  id: string;
  title: string;
  sub: string;
  state: "on-phone" | "update" | "not-downloaded";
  progress?: number;
  size?: string;
}

const CARDS: CourseCard[] = [
  {
    id: "science-8",
    title: "Science 8",
    sub: "Division of Cavite · 8 chapters",
    state: "on-phone",
    progress: 62,
  },
  {
    id: "math-8",
    title: "Math 8",
    sub: "On this phone · updated by your division",
    state: "update",
  },
  {
    id: "filipino-8",
    title: "Filipino 8",
    sub: "Not on this phone yet",
    state: "not-downloaded",
    size: "31 MB",
  },
];

export default function CoursesPage() {
  const online = useOnline();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "on-phone">("all");

  const [liveMsg, setLiveMsg] = useState("");
  const firstStatus = useRef(true);
  useEffect(() => {
    if (firstStatus.current) {
      firstStatus.current = false;
      return;
    }
    setLiveMsg(online ? copy.syncCenter.pillAllClear : copy.environment.offline);
  }, [online]);

  const visible = CARDS.filter(
    (c) =>
      c.title.toLowerCase().includes(query.trim().toLowerCase()) &&
      (filter === "all" || c.state !== "not-downloaded"),
  );

  return (
    <AppShell examBadge={1}>
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
            {online ? (
              <SyncPill state="synced" label={copy.syncCenter.pillAllClear} />
            ) : (
              <SyncPill state="on-device" label={copy.syncCenter.pillResting(8)} offline />
            )}
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

        {visible.map((c) => (
          <CourseCardRow key={c.id} course={c} online={online} />
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

function CourseCardRow({ course, online }: { course: CourseCard; online: boolean }) {
  const muted = course.state === "not-downloaded";
  return (
    <div
      style={{
        position: "relative",
        background: "var(--color-card)",
        border: `1.5px solid ${course.state === "update" ? "var(--color-warning-border)" : "var(--color-border)"}`,
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
            {!online && muted ? `Needs connection to download · ${course.size}` : course.sub}
          </div>
        </div>
        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", minHeight: 48 }}>
          {course.state === "on-phone" ? (
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
          ) : course.state === "update" ? (
            <Chip tone="on-device" size="compact" icon={<Icon name="download" size={12} />}>
              2 pages changed
            </Chip>
          ) : (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 11.5,
                fontWeight: 700,
                color: online ? "var(--color-primary)" : "var(--color-ink-faint)",
              }}
            >
              <Icon name="download" size={13} />
              {online ? `Get · ${course.size}` : "Get later"}
            </span>
          )}
        </div>
      </div>
      {typeof course.progress === "number" ? (
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 10 }}>
          <Bar
            percent={course.progress}
            style={{ flex: 1 }}
            aria-label={`${course.title} — ${course.progress}% done`}
          />
          <span
            className="rl-num"
            style={{ fontSize: 11, fontWeight: 700, color: "var(--color-ink-subtle)" }}
          >
            {course.progress}%
          </span>
        </div>
      ) : null}
    </div>
  );
}
