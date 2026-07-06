"use client";

/**
 * Course player (key-screens p3c, deep-dives d4a–d4e) — immersive reading
 * surface: no tab bar, sticky context bar + pager, TOC bottom sheet that
 * docks as a persistent rail at ≥720px. Video block cycles through all four
 * designed states; the Next button carries the shape-redundant prefetch
 * bead (hollow / center dot / green check — never color alone).
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Chip, Icon } from "@rl/ui";
import * as copy from "@/lib/copy";
import { courses } from "@/lib/fixtures";
import { useDemo, useOnline } from "@/lib/demo";
import {
  BackButton,
  CH3_CRUMB,
  Chevron,
  chapter3Pages,
} from "../../course-shared";

type VideoState =
  | { state: "on-device" }
  | { state: "none" }
  | { state: "downloading"; pct: number; paused: boolean };

type Avail = "none" | "fetching" | "ready";

const QUICK_OPTIONS = ["up to 61 km/h", "89–117 km/h"] as const;

export default function PlayerPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const course = courses.find((c) => c.id === courseId) ?? courses[0];
  const online = useOnline();
  const { connectivity } = useDemo();

  const [pageNo, setPageNo] = useState(5);
  const [page6, setPage6] = useState<Avail>("none");
  const [pageLoading, setPageLoading] = useState(false);
  const [video, setVideo] = useState<VideoState>({ state: "on-device" });
  const [quickSel, setQuickSel] = useState<number | null>(null);
  const [tocOpen, setTocOpen] = useState(false);
  const [isWide, setIsWide] = useState(false);
  const [liveMsg, setLiveMsg] = useState("");

  const contentRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

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

  /* ----- prefetch of the next page (page 6) — d4c dot grammar -----
     Runs only while reading page 5 and connected; visible "fetching"
     activity only on slow links (>400ms). Offline → stays hollow. */
  useEffect(() => {
    if (page6 === "ready" || pageNo !== 5 || !online) return;
    const slow = connectivity === "slow-2g";
    if (slow) setPage6("fetching");
    const t = setTimeout(
      () => {
        setPage6("ready");
        setLiveMsg("Next page is on this phone — ready.");
      },
      slow ? 2600 : 350,
    );
    return () => clearTimeout(t);
  }, [page6, pageNo, online, connectivity]);
  useEffect(() => {
    if (!online) setPage6((p) => (p === "fetching" ? "none" : p));
  }, [online]);

  /* ----- video download simulation ----- */
  useEffect(() => {
    if (video.state !== "downloading" || video.paused || !online) return;
    const t = setInterval(
      () =>
        setVideo((v) =>
          v.state === "downloading" ? { ...v, pct: Math.min(100, v.pct + 3) } : v,
        ),
      300,
    );
    return () => clearInterval(t);
  }, [video, online]);
  useEffect(() => {
    if (video.state === "downloading" && video.pct >= 100) {
      setVideo({ state: "on-device" });
      setLiveMsg("Video is on this phone — scrub instantly.");
    }
  }, [video]);

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

  const page = chapter3Pages.find((p) => p.n === pageNo) ?? chapter3Pages[4]!;
  const nextBead: Avail | "end" = pageNo < 5 ? "ready" : pageNo === 5 ? page6 : "end";

  const goTo = (n: number) => {
    setPageNo(n);
    setTocOpen(false);
    setPageLoading(false);
    contentRef.current?.scrollIntoView({ block: "start" });
  };

  const getPage6 = () => {
    setPageLoading(true);
    const slow = connectivity === "slow-2g";
    setTimeout(
      () => {
        setPage6("ready");
        setPageLoading(false);
        setLiveMsg("Page is on this phone.");
      },
      slow ? 1500 : 400,
    );
  };

  const page6Missing = pageNo === 6 && page6 !== "ready";

  return (
    <div className="plyr-root">
      <style>{playerCss}</style>
      <span className="plyr-vh" aria-live="polite">
        {liveMsg}
      </span>

      {/* ----- docked TOC rail (≥720px, d4e) ----- */}
      {isWide ? (
        <nav className="plyr-rail" aria-label="Chapters and pages">
          <TocPanel courseTitle={course.title} currentPage={pageNo} page6={page6} onGo={goTo} />
        </nav>
      ) : null}

      <div className="plyr-main">
        {/* ----- sticky context bar — tap anywhere on it opens the TOC ----- */}
        <div className="plyr-chrome">
          <BackButton href={`/courses/${course.id}`} label="Back to course contents" size={40} iconSize={18} />
          <button
            type="button"
            className="plyr-context"
            onClick={() => {
              if (!isWide) setTocOpen(true);
            }}
            aria-label="Open chapters and pages"
            aria-haspopup="dialog"
          >
            <span className="plyr-crumb">{CH3_CRUMB}</span>
            <span className="plyr-page-title rl-num">
              Page {pageNo} of 6 — {page.title}
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
          {pageLoading ? (
            <SkeletonPage />
          ) : page6Missing ? (
            <PageNotOnPhone online={online} onGet={getPage6} onSkip={() => (isWide ? undefined : setTocOpen(true))} />
          ) : (
            <>
              <h1 style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.3, margin: 0 }}>{page.h1}</h1>
              {page.body.map((para) => (
                <p
                  key={para.slice(0, 24)}
                  style={{
                    fontSize: 15.5,
                    lineHeight: 1.65,
                    color: "var(--color-ink-secondary)",
                    margin: 0,
                    maxWidth: "34em",
                  }}
                >
                  {para}
                </p>
              ))}

              {pageNo === 5 ? (
                <>
                  <VideoBlock
                    video={video}
                    online={online}
                    onRemove={() => setVideo({ state: "none" })}
                    onLoad={() => setVideo({ state: "downloading", pct: 3, paused: false })}
                    onPauseToggle={() =>
                      setVideo((v) =>
                        v.state === "downloading" ? { ...v, paused: !v.paused } : v,
                      )
                    }
                  />
                  <QuickCheck selected={quickSel} onSelect={(i) => setQuickSel(i)} />
                </>
              ) : null}
            </>
          )}
        </div>

        {/* ----- sticky pager — prefetch bead on Next ----- */}
        <div className="plyr-pager">
          <button
            type="button"
            className="plyr-prev"
            disabled={pageNo <= 1}
            onClick={() => goTo(pageNo - 1)}
          >
            <Chevron size={15} dir="left" />
            Previous
          </button>
          <button
            type="button"
            className="rl-btn rl-btn--primary plyr-next"
            disabled={nextBead === "end"}
            onClick={() => goTo(pageNo + 1)}
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
            <TocPanel courseTitle={course.title} currentPage={pageNo} page6={page6} onGo={goTo} />
          </div>
        </>
      ) : null}
    </div>
  );
}

/* =============== TOC — same component in sheet and rail (d4e) =============== */

function TocPanel({
  courseTitle,
  currentPage,
  page6,
  onGo,
}: {
  courseTitle: string;
  currentPage: number;
  page6: Avail;
  onGo: (n: number) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minHeight: 0 }}>
      <div style={{ fontSize: 14, fontWeight: 800, padding: "0 6px 8px" }}>{courseTitle}</div>

      <TocChapterRow label="1 · Earthquakes and faults" done />
      <TocChapterRow label="2 · Typhoons" done />

      {/* expanded current chapter */}
      <div style={{ background: "var(--color-primary-tint)", borderRadius: 9, padding: "8px 9px" }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: "var(--color-primary)" }}>
          3 · Weather disturbances
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1, marginTop: 4 }}>
          {chapter3Pages.map((p) => {
            const current = p.n === currentPage;
            const hollow = p.n === 6 && page6 !== "ready";
            return (
              <button
                key={p.n}
                type="button"
                onClick={() => onGo(p.n)}
                aria-current={current ? "page" : undefined}
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
                  fontWeight: current ? 800 : 500,
                  color: current ? "var(--color-primary)" : "var(--color-ink-secondary)",
                  background: current ? "var(--color-card)" : "transparent",
                }}
              >
                <span>
                  {p.n} · {p.title}
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
                ) : p.n === 6 ? (
                  <span style={{ color: "var(--color-synced-solid)", display: "inline-flex" }}>
                    <Icon name="check" size={11} />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <TocChapterRow label="4 · Interactions in ecosystems" download="24 MB" />
      <TocChapterRow label="5 · Motion" download="6 MB" />

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
        Course: 45 MB on device ·{" "}
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

/* =============== video block — all four states (d4b) =============== */

function VideoBlock({
  video,
  online,
  onRemove,
  onLoad,
  onPauseToggle,
}: {
  video: VideoState;
  online: boolean;
  onRemove: () => void;
  onLoad: () => void;
  onPauseToggle: () => void;
}) {
  if (video.state === "on-device") {
    return (
      <div style={{ background: "#0F1526", borderRadius: 14, overflow: "hidden" }}>
        <div
          style={{
            position: "relative",
            height: 140,
            background:
              "repeating-linear-gradient(45deg,#131C31,#131C31 10px,#0F1526 10px,#0F1526 20px)",
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 9,
              left: 10,
              fontSize: 9,
              fontFamily: "ui-monospace, Menlo, monospace",
              color: "#93A3C4",
            }}
          >
            video: how signals are raised · 4:12
          </span>
          <button
            type="button"
            aria-label="Play video: how signals are raised"
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%,-50%)",
              width: 52,
              height: 52,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.14)",
              border: "2px solid #ffffff",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span
              style={{
                width: 0,
                height: 0,
                borderTop: "9px solid transparent",
                borderBottom: "9px solid transparent",
                borderLeft: "16px solid #ffffff",
                marginLeft: 4,
              }}
            />
          </button>
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
            24 MB ·{" "}
            <button
              type="button"
              onClick={onRemove}
              aria-label="Remove this video from your phone · frees 24 MB"
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
          </span>
        </div>
      </div>
    );
  }

  if (video.state === "downloading") {
    const stalled = !online;
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
          <span>How signals are raised</span>
          <span className="rl-num">
            {Math.round(video.pct)}% {stalled ? "kept" : "· 24 MB"}
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
          aria-valuenow={Math.round(video.pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Video download"
        >
          <div
            style={{
              width: `${video.pct}%`,
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
        ) : (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
            <button
              type="button"
              onClick={onPauseToggle}
              aria-label={video.paused ? "Continue download" : "Pause download"}
              style={{
                width: 48,
                height: 48,
                border: "none",
                background: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                padding: 0,
              }}
            >
              <span
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  border: "1.5px solid var(--color-border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--color-ink)",
                }}
              >
                {video.paused ? (
                  <span
                    style={{
                      width: 0,
                      height: 0,
                      borderTop: "6px solid transparent",
                      borderBottom: "6px solid transparent",
                      borderLeft: "10px solid currentColor",
                      marginLeft: 2,
                    }}
                  />
                ) : (
                  <Icon name="pause" size={12} />
                )}
              </span>
            </button>
          </div>
        )}
      </div>
    );
  }

  /* not downloaded */
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
            Connect to download — the page text still works.
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
          Get · 24 MB
        </span>
      </div>
    );
  }

  /* d4b state 4 — data saver on (student default): tap to load, sized */
  return (
    <div
      style={{
        background: "var(--color-card)",
        border: "1.5px solid var(--color-warning-border)",
        borderRadius: 14,
        padding: 14,
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
      }}
    >
      <span style={{ color: "var(--color-on-device-fg)", display: "inline-flex", marginTop: 2 }}>
        <Icon name="download" size={18} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-on-device-fg)" }}>
          Data saver is on
        </div>
        <div style={{ fontSize: 11, color: "var(--color-ink-subtle)", marginTop: 2, lineHeight: 1.45 }}>
          Streaming would use ~24 MB. Tap to load anyway, or download on Wi-Fi later.
        </div>
      </div>
      <button
        type="button"
        onClick={onLoad}
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
        Load
      </button>
    </div>
  );
}

/* =============== quick check — grades locally, instantly =============== */

function QuickCheck({
  selected,
  onSelect,
}: {
  selected: number | null;
  onSelect: (i: number) => void;
}) {
  return (
    <div className="rl-card" style={{ borderWidth: 1.5, padding: "13px 14px" }}>
      <div className="rl-overline">Quick check</div>
      <div id="quick-check-prompt" style={{ fontSize: 14.5, fontWeight: 700, lineHeight: 1.4, marginTop: 5 }}>
        Signal No. 3 means winds of…
      </div>
      <div
        role="radiogroup"
        aria-labelledby="quick-check-prompt"
        style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 9 }}
      >
        {QUICK_OPTIONS.map((opt, i) => {
          const sel = selected === i;
          return (
            <button
              key={opt}
              type="button"
              role="radio"
              aria-checked={sel}
              onClick={() => onSelect(i)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                minHeight: 40,
                padding: "8px 11px",
                borderRadius: 10,
                fontSize: 13,
                fontFamily: "inherit",
                textAlign: "left",
                cursor: "pointer",
                fontWeight: sel ? 600 : 400,
                border: sel ? "2px solid var(--color-primary)" : "1.5px solid var(--color-border)",
                background: sel ? "var(--color-primary-selected)" : "var(--color-card)",
                color: "var(--color-ink)",
              }}
            >
              {opt}
              {sel ? (
                <span style={{ color: "var(--color-primary)", display: "inline-flex" }}>
                  <Icon name="check" size={14} />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {selected !== null ? (
        <div role="status" style={{ marginTop: 9 }}>
          <Chip tone="synced" size="compact" icon={<Icon name="check" size={12} />}>
            Saved on this phone
          </Chip>
        </div>
      ) : null}
    </div>
  );
}

/* =============== page-availability states (d4c) =============== */

function SkeletonPage() {
  return (
    <div className="rl-card" style={{ borderWidth: 1.5, padding: 14 }} aria-hidden>
      <div className="rl-skeleton" style={{ height: 16, width: "70%", borderRadius: 7 }} />
      <div className="rl-skeleton rl-skeleton--soft" style={{ height: 11, width: "100%", borderRadius: 5, marginTop: 12 }} />
      <div className="rl-skeleton rl-skeleton--soft" style={{ height: 11, width: "96%", borderRadius: 5, marginTop: 7 }} />
      <div className="rl-skeleton rl-skeleton--soft" style={{ height: 11, width: "88%", borderRadius: 5, marginTop: 7 }} />
      <div className="rl-skeleton" style={{ height: 90, borderRadius: 10, marginTop: 12 }} />
    </div>
  );
}

function PageNotOnPhone({
  online,
  onGet,
  onSkip,
}: {
  online: boolean;
  onGet: () => void;
  onSkip: () => void;
}) {
  return (
    <div
      className="rl-card"
      style={{ borderWidth: 1.5, padding: "20px 16px", textAlign: "center" }}
    >
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
        <Icon name="no-signal" size={24} />
      </div>
      <div style={{ fontSize: 15, fontWeight: 800, marginTop: 10 }}>
        This page isn&rsquo;t on your phone
      </div>
      <div
        style={{
          fontSize: 12,
          color: "var(--color-ink-subtle)",
          lineHeight: 1.5,
          marginTop: 5,
        }}
      >
        It needs a connection once (120 KB). Everything you&rsquo;ve downloaded still works.
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "center" }}>
        <button
          type="button"
          className="rl-btn rl-btn--primary"
          style={{ height: 40, padding: "0 16px", fontSize: 12.5, fontWeight: 800 }}
          disabled={!online}
          onClick={onGet}
        >
          Get this page
        </button>
        <button
          type="button"
          onClick={onSkip}
          style={{
            height: 40,
            padding: "0 16px",
            border: "1.5px solid var(--color-border)",
            color: "var(--color-ink-secondary)",
            background: "var(--color-card)",
            borderRadius: 999,
            fontSize: 12.5,
            fontWeight: 800,
            fontFamily: "inherit",
            cursor: "pointer",
          }}
        >
          Skip ahead
        </button>
      </div>
      {!online ? (
        <div style={{ fontSize: 11, color: "var(--color-ink-subtle)", marginTop: 8 }}>
          {copy.syncCenter.downloadStalled}
        </div>
      ) : null}
    </div>
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
  if (status === "fetching") {
    return (
      <span
        aria-hidden
        className="plyr-bead-pulse"
        style={{
          width: 14,
          height: 14,
          borderRadius: "50%",
          border: "2px solid rgba(255,255,255,0.8)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          boxSizing: "border-box",
        }}
      >
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#ffffff" }} />
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
.plyr-page-title{display:block;font-size:14px;font-weight:700;color:var(--color-ink);margin-top:1px;}
.plyr-content{flex:1;display:flex;flex-direction:column;gap:12px;padding:6px 16px 12px;width:100%;}
.plyr-pager{position:sticky;bottom:0;z-index:10;background:var(--color-card);box-shadow:0 -1px 0 var(--color-border);padding:11px 14px 13px;display:flex;gap:9px;width:100%;}
.plyr-prev{flex:1;height:48px;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1.5px solid var(--color-border);border-radius:999px;font-size:13.5px;font-weight:700;color:var(--color-ink-secondary);background:var(--color-card);font-family:inherit;cursor:pointer;}
.plyr-prev:disabled{opacity:0.5;cursor:default;}
.plyr-next{flex:1.3;height:48px;font-size:14px;font-weight:800;}
.plyr-dl-card{background:var(--color-card);border:1.5px solid #ADC4F5;border-radius:14px;padding:12px 14px;}
[data-theme="dark"] .plyr-dl-card{border-color:#2C4270;}
@media (prefers-reduced-motion: no-preference){
  .plyr-bead-pulse{animation:plyr-pulse 1.2s ease-in-out infinite;}
}
@keyframes plyr-pulse{0%,100%{opacity:1;}50%{opacity:0.45;}}
@media (min-width:720px){
  .plyr-rail{display:flex;flex-direction:column;width:236px;flex-shrink:0;background:var(--color-card);border-right:1px solid var(--color-border);padding:14px 12px;position:sticky;top:0;height:100dvh;overflow:auto;}
  .plyr-main{max-width:none;margin:0;}
  .plyr-chrome{padding:13px 20px 8px;}
  .plyr-content{max-width:520px;padding:4px 20px 14px;}
  .plyr-pager{max-width:520px;padding:11px 20px 16px;}
}
`;
