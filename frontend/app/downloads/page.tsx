"use client";

/**
 * Download manager — "the pocketbook and the shelf" (key-screens p3e,
 * deep-dives d5a–d5d). Storage meter with app-managed segments + legend,
 * guided cleanup (never automatic), serial download queue with pause /
 * resume / offline-stall, and remove affordances that always say what
 * stays. Everything is local state; the demo connectivity drives stalls.
 */

import { useEffect, useRef, useState } from "react";
import { Button, Icon, StorageBar, ToggleRow } from "@rl/ui";
import { AppShell } from "@/components/app-chrome";
import * as copy from "@/lib/copy";
import { useOnline } from "@/lib/demo";

const EYEBROW: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 800,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--color-ink-subtle)",
  marginTop: 2,
};

interface DlItem {
  id: string;
  title: string;
  sizeMb: number;
  pct: number;
  status: "running" | "paused" | "queued" | "done";
  kind: "videos" | "pages";
}

const WATCHED_VIDEOS = [
  { title: "Ch. 1 video — earthquakes", size: "210 MB" },
  { title: "Ch. 2 video — typhoons", size: "205 MB" },
  { title: "Ch. 3 video — storm signals", size: "205 MB" },
] as const;

const DEVICE_MB = 2000;

function fmtMb(mb: number) {
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

export default function DownloadsPage() {
  const online = useOnline();

  /* app-managed storage segments (quota-estimate style) */
  const [store, setStore] = useState({ videos: 1000, pages: 380, exams: 210 });
  const [cleaned, setCleaned] = useState(false);
  const [scienceState, setScienceState] = useState<"on" | "removed" | "downloading">("on");
  const [dataSaver, setDataSaver] = useState(true);

  const [items, setItems] = useState<DlItem[]>([
    { id: "ch4-video", title: "Ch. 4 video — ecosystems", sizeMb: 24, pct: 45, status: "running", kind: "videos" },
    { id: "fil8-ch1", title: "Filipino 8 · Chapter 1", sizeMb: 6, pct: 0, status: "queued", kind: "pages" },
  ]);

  const [removeOpen, setRemoveOpen] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [liveMsg, setLiveMsg] = useState("");

  /* ----- serial queue tick — one at a time, resumable, bytes-true ----- */
  useEffect(() => {
    if (!online) return;
    const t = setInterval(() => {
      setItems((prev) => {
        const head = prev.find((i) => i.status === "running");
        if (!head) return prev;
        const pct = Math.min(100, head.pct + 1.4);
        let promoted = false;
        return prev.map((i) => {
          if (i.id === head.id) return { ...i, pct, status: pct >= 100 ? "done" : "running" };
          if (pct >= 100 && !promoted && i.status === "queued") {
            promoted = true;
            return { ...i, status: "running" };
          }
          return i;
        });
      });
    }, 400);
    return () => clearInterval(t);
  }, [online]);

  /* completions: add to the meter, announce, settle Science 8 re-download */
  const announced = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const item of items) {
      if (item.status === "done" && !announced.current.has(item.id)) {
        announced.current.add(item.id);
        setStore((s) => ({ ...s, [item.kind]: s[item.kind] + item.sizeMb }));
        setLiveMsg(`${item.title} is on this phone.`);
        if (item.id === "sci8") {
          setScienceState("on");
          setItems((prev) => prev.filter((i) => i.id !== "sci8"));
        }
      }
    }
  }, [items]);

  /* offline announcement */
  const firstStatus = useRef(true);
  useEffect(() => {
    if (firstStatus.current) {
      firstStatus.current = false;
      return;
    }
    setLiveMsg(online ? "Connected — downloads continue." : copy.syncCenter.downloadStalled);
  }, [online]);

  /* Esc closes dialogs */
  useEffect(() => {
    if (!removeOpen && !cleanupOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setRemoveOpen(false);
        setCleanupOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [removeOpen, cleanupOpen]);

  const usedMb = store.videos + store.pages + store.exams;
  const nearlyFull = usedMb / DEVICE_MB >= 0.8;

  const pause = (id: string) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, status: "paused" } : i)));
  const resume = (id: string) =>
    setItems((prev) =>
      prev.map((i) =>
        i.id === id
          ? { ...i, status: prev.some((o) => o.id !== id && o.status === "running") ? "queued" : "running" }
          : i,
      ),
    );

  const doCleanup = () => {
    setStore((s) => ({ ...s, videos: s.videos - 620 }));
    setCleaned(true);
    setCleanupOpen(false);
    setLiveMsg("620 MB freed on this phone.");
  };

  const removeScience = () => {
    setStore((s) => ({ ...s, pages: s.pages - 45 }));
    setScienceState("removed");
    setRemoveOpen(false);
    setLiveMsg("Science 8 content removed — your progress and grades stay safe.");
  };

  const getScienceBack = () => {
    setScienceState("downloading");
    announced.current.delete("sci8");
    setItems((prev) => [
      ...prev,
      {
        id: "sci8",
        title: "Science 8 — full course",
        sizeMb: 45,
        pct: 0,
        status: prev.some((i) => i.status === "running") ? "queued" : "running",
        kind: "pages",
      },
    ]);
  };

  const activeItems = items.filter((i) => i.status !== "done");
  const doneItems = items.filter((i) => i.status === "done" && i.id !== "sci8");

  return (
    <AppShell examBadge={1}>
      <style>{dlCss}</style>
      <div className="page-body dlm-root" style={{ padding: 16 }}>
        <span className="dlm-vh" aria-live="polite">
          {liveMsg}
        </span>

        <h1 style={{ fontSize: 19, fontWeight: 800, margin: 0 }}>Downloads &amp; storage</h1>

        {/* ----- storage meter — segments are app-managed content only ----- */}
        <div className="rl-card" style={{ borderWidth: 1.5, padding: "13px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, fontWeight: 700 }}>
            <span>This phone</span>
            <span
              className="rl-num"
              style={{ color: nearlyFull ? "var(--color-on-device-fg)" : "var(--color-synced-fg)" }}
            >
              {(usedMb / 1000).toFixed(1)} GB of 2 GB used
            </span>
          </div>
          <StorageBar
            style={{ marginTop: 8 }}
            aria-label={`Storage: ${fmtMb(store.videos)} videos, ${fmtMb(store.pages)} pages, ${fmtMb(store.exams)} exams, ${fmtMb(DEVICE_MB - usedMb)} free`}
            segments={[
              { percent: (store.videos / DEVICE_MB) * 100, color: "var(--seg-videos)", label: "Videos" },
              { percent: (store.pages / DEVICE_MB) * 100, color: "var(--seg-pages)", label: "Pages" },
              { percent: (store.exams / DEVICE_MB) * 100, color: "var(--seg-exams)", label: "Exams" },
            ]}
          />
          <div
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              fontSize: 10.5,
              color: "var(--color-ink-subtle)",
              marginTop: 8,
            }}
          >
            <LegendItem colorVar="--seg-videos" label={`Videos ${fmtMb(store.videos)}`} />
            <LegendItem colorVar="--seg-pages" label={`Pages ${fmtMb(store.pages)}`} />
            <LegendItem colorVar="--seg-exams" label={`Exams ${fmtMb(store.exams)}`} />
          </div>
        </div>

        {/* ----- storage-full banner — amber from 80%, action in the sentence ----- */}
        {nearlyFull ? (
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
            <button type="button" className="dlm-link" onClick={() => setCleanupOpen(true)}>
              Free up
            </button>
          </div>
        ) : null}

        {/* ----- guided cleanup — suggested, never automatic ----- */}
        {!cleaned ? (
          <div
            style={{
              background: "var(--color-card)",
              border: "1.5px solid var(--color-success-border)",
              borderRadius: 14,
              padding: "12px 13px",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <div
              className="rl-tile"
              style={{ width: 36, height: 36, background: "var(--color-synced-bg)", color: "var(--color-synced-solid)" }}
            >
              <Icon name="check" size={16} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>Suggested: 3 watched videos</div>
              <div style={{ fontSize: 11, color: "var(--color-ink-subtle)", marginTop: 1 }}>
                You finished these chapters · frees 620 MB
              </div>
            </div>
            <button
              type="button"
              className="dlm-link"
              onClick={() => setCleanupOpen(true)}
              aria-label="Review 3 watched videos to free 620 MB"
            >
              Review
            </button>
          </div>
        ) : null}

        {/* ----- active queue — serial, exams jump the queue ----- */}
        <div style={EYEBROW}>Active — one at a time</div>
        {activeItems.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--color-ink-subtle)", padding: "2px 2px" }}>
            Nothing downloading right now.
          </div>
        ) : (
          activeItems.map((item, idx) => (
            <DownloadRow
              key={item.id}
              item={item}
              online={online}
              isHead={idx === 0}
              onPause={() => pause(item.id)}
              onResume={() => resume(item.id)}
            />
          ))
        )}

        {/* ----- the shelf ----- */}
        <div style={EYEBROW}>On this phone</div>

        {scienceState === "on" ? (
          <div className="rl-card" style={{ borderWidth: 1.5, padding: "12px 14px", display: "flex", alignItems: "center", gap: 11 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>Science 8 — full course</div>
              <div className="rl-num" style={{ fontSize: 11, color: "var(--color-ink-subtle)", marginTop: 1 }}>
                45 MB · 8 chapters · exam included
              </div>
            </div>
            <button
              type="button"
              className="dlm-link"
              style={{ color: "var(--color-ink-subtle)" }}
              onClick={() => setRemoveOpen(true)}
            >
              Remove…
            </button>
          </div>
        ) : scienceState === "removed" ? (
          <div
            className="rl-card"
            style={{ borderWidth: 1.5, padding: "12px 14px", display: "flex", alignItems: "center", gap: 11, opacity: 0.85 }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>Science 8 — full course</div>
              <div style={{ fontSize: 11, color: "var(--color-ink-subtle)", marginTop: 1 }}>
                Not on this phone
              </div>
            </div>
            <button
              type="button"
              className="dlm-link"
              disabled={!online}
              style={{ color: online ? "var(--color-primary)" : "var(--color-ink-faint)" }}
              onClick={getScienceBack}
            >
              <Icon name="download" size={13} />
              {online ? "Get · 45 MB" : "Get later"}
            </button>
          </div>
        ) : null}

        {doneItems.map((item) => (
          <div
            key={item.id}
            className="rl-card"
            style={{ borderWidth: 1.5, padding: "12px 14px", display: "flex", alignItems: "center", gap: 11 }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{item.title}</div>
              <div className="rl-num" style={{ fontSize: 11, color: "var(--color-ink-subtle)", marginTop: 1 }}>
                {item.sizeMb} MB · on this phone
              </div>
            </div>
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
          </div>
        ))}

        {/* ----- data saver — default ON for student accounts ----- */}
        <ToggleRow
          title="Data saver"
          description="Nothing downloads without asking. Pages load when you tap."
          checked={dataSaver}
          onChange={setDataSaver}
        />
      </div>

      {/* ----- remove confirm — says what stays ----- */}
      {removeOpen ? (
        <>
          <div className="scrim" onClick={() => setRemoveOpen(false)} aria-hidden />
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dlm-remove-title">
            <div id="dlm-remove-title" style={{ fontSize: 14.5, fontWeight: 800 }}>
              Remove Science 8 from this phone?
            </div>
            <div
              style={{ fontSize: 12.5, color: "var(--color-ink-secondary)", lineHeight: 1.55, marginTop: 6 }}
            >
              Frees 45 MB. <b style={{ color: "var(--color-ink)" }}>Your progress, quiz answers, and grades stay safe</b>{" "}
              — only the content leaves. You can download it again anytime.
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button type="button" className="dlm-keep" onClick={() => setRemoveOpen(false)} autoFocus>
                Keep
              </button>
              <Button
                variant="destructive"
                style={{ flex: 1, height: 44, fontSize: 13, fontWeight: 800 }}
                onClick={removeScience}
              >
                Remove · 45 MB
              </Button>
            </div>
          </div>
        </>
      ) : null}

      {/* ----- guided cleanup review ----- */}
      {cleanupOpen ? (
        <>
          <div className="scrim" onClick={() => setCleanupOpen(false)} aria-hidden />
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="dlm-cleanup-title">
            <div className="sheet__grabber" />
            <div id="dlm-cleanup-title" style={{ fontSize: 16, fontWeight: 800 }}>
              Suggested: 3 watched videos
            </div>
            <div style={{ fontSize: 12, color: "var(--color-ink-subtle)", marginTop: 2 }}>
              You finished these chapters · frees 620 MB
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 13 }}>
              {WATCHED_VIDEOS.map((v) => (
                <div
                  key={v.title}
                  className="rl-row"
                  style={{ borderRadius: 12 }}
                >
                  <span style={{ color: "var(--color-synced-solid)", display: "inline-flex" }}>
                    <Icon name="check" size={14} />
                  </span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{v.title}</span>
                  <span className="rl-num" style={{ fontSize: 11.5, color: "var(--color-ink-subtle)", fontWeight: 700 }}>
                    {v.size}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--color-ink-subtle)", lineHeight: 1.5, marginTop: 10 }}>
              Your progress and grades stay safe — only the content leaves this phone.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
              <Button
                variant="destructive"
                style={{ height: 44, fontSize: 13.5, fontWeight: 800, width: "100%" }}
                onClick={doCleanup}
              >
                Remove 3 videos · free 620 MB
              </Button>
              <Button variant="quiet" style={{ height: 40, fontSize: 13, color: "var(--color-ink-subtle)" }} onClick={() => setCleanupOpen(false)}>
                Not now
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </AppShell>
  );
}

/* ---------- one download row: running / paused / queued / stalled ---------- */

function DownloadRow({
  item,
  online,
  isHead,
  onPause,
  onResume,
}: {
  item: DlItem;
  online: boolean;
  isHead: boolean;
  onPause: () => void;
  onResume: () => void;
}) {
  const doneMb = ((item.pct / 100) * item.sizeMb).toFixed(1);

  if (item.status === "queued") {
    return (
      <div
        style={{
          background: "var(--color-surface-muted)",
          border: "1.5px solid var(--color-border)",
          borderRadius: 14,
          padding: "12px 13px",
          display: "flex",
          alignItems: "center",
          gap: 11,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-ink-subtle)" }}>{item.title}</div>
          <div style={{ fontSize: 11, color: "var(--color-ink-faint)", marginTop: 2 }}>
            Waiting — starts after the video above
          </div>
        </div>
        <span className="rl-num" style={{ fontSize: 11, color: "var(--color-ink-faint)", fontWeight: 700 }}>
          {item.sizeMb} MB
        </span>
      </div>
    );
  }

  if (item.status === "paused") {
    return (
      <div
        style={{
          background: "var(--color-surface-muted)",
          border: "1.5px solid var(--color-border)",
          borderRadius: 14,
          padding: "12px 13px",
          display: "flex",
          alignItems: "center",
          gap: 11,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            className="rl-num"
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 10,
              fontSize: 12.5,
              fontWeight: 600,
              color: "var(--color-ink-subtle)",
            }}
          >
            <span>{item.title}</span>
            <span>
              Paused · {doneMb} of {item.sizeMb} MB
            </span>
          </div>
          <div
            style={{ height: 6, background: "var(--color-desk)", borderRadius: 3, marginTop: 7, overflow: "hidden" }}
            role="progressbar"
            aria-valuenow={Math.round(item.pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${item.title} — paused`}
          >
            <div style={{ width: `${item.pct}%`, height: "100%", background: "var(--color-ink-faint)" }} />
          </div>
        </div>
        <button type="button" className="dlm-resume" onClick={onResume}>
          Resume
        </button>
      </div>
    );
  }

  /* running — or stalled when the demo says offline */
  const stalled = !online;
  return (
    <div className={stalled ? "rl-card" : "dlm-active"} style={{ borderWidth: 1.5, padding: "12px 13px", display: "flex", alignItems: "center", gap: 11, borderStyle: "solid", borderRadius: 14, background: "var(--color-card)" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5, fontWeight: 600 }}
        >
          <span>{item.title}</span>
          <span
            className="rl-num"
            style={{ color: stalled ? "var(--color-on-device-fg)" : "var(--color-primary)" }}
          >
            {Math.round(item.pct)}% {stalled ? "kept" : `· ${item.sizeMb} MB`}
          </span>
        </div>
        <div
          style={{
            height: 6,
            background: "var(--color-desk)",
            borderRadius: 3,
            marginTop: 7,
            overflow: "hidden",
          }}
          role="progressbar"
          aria-valuenow={Math.round(item.pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${item.title} download`}
        >
          <div
            style={{
              width: `${item.pct}%`,
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
      {!stalled && isHead ? (
        <button type="button" onClick={onPause} aria-label={`Pause download: ${item.title}`} className="dlm-pause-hit">
          <span className="dlm-pause-circle">
            <Icon name="pause" size={13} />
          </span>
        </button>
      ) : null}
    </div>
  );
}

function LegendItem({ colorVar, label }: { colorVar: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span
        aria-hidden
        style={{ width: 8, height: 8, borderRadius: 2, background: `var(${colorVar})`, flexShrink: 0 }}
      />
      <span className="rl-num">{label}</span>
    </span>
  );
}

/* ---------- local styles ---------- */

const dlCss = `
.dlm-vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;}
.dlm-root{--seg-videos:var(--color-primary);--seg-pages:#7CA0F5;--seg-exams:#C77C10;}
[data-theme="dark"] .dlm-root{--seg-pages:#8FB0FF;--seg-exams:#D89230;}
.dlm-active{border:1.5px solid #ADC4F5;}
[data-theme="dark"] .dlm-active{border-color:#2C4270;}
.dlm-link{display:inline-flex;align-items:center;gap:5px;border:none;background:none;font-family:inherit;font-size:12px;font-weight:800;color:var(--color-primary);cursor:pointer;min-height:48px;padding:0 4px;}
.dlm-link:disabled{cursor:default;}
.dlm-resume{height:34px;padding:0 13px;background:var(--color-primary-tint);color:var(--color-primary);border:none;border-radius:999px;font-family:inherit;font-size:11.5px;font-weight:800;cursor:pointer;}
.dlm-pause-hit{width:48px;height:48px;border:none;background:none;padding:0;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;}
.dlm-pause-circle{width:42px;height:42px;border-radius:50%;border:1.5px solid var(--color-border);display:flex;align-items:center;justify-content:center;color:var(--color-ink);}
.dlm-keep{flex:1;height:44px;border:1.5px solid var(--color-border);color:var(--color-ink-subtle);background:var(--color-card);border-radius:999px;font-family:inherit;font-size:13px;font-weight:800;cursor:pointer;}
`;
