"use client";

/**
 * Download manager — "the pocketbook and the shelf" (key-screens p3e,
 * deep-dives d5a–d5d) — REAL: the shelf is the actual IndexedDB inventory
 * (course manifests, video blobs, exam packages) with true sizes, the
 * storage meter reads navigator.storage.estimate() where available, active
 * rows mirror in-flight engine downloads (with the calm offline stall), and
 * Remove always says what stays. Exam packages are read-only rows — they
 * leave on their own when the window closes.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Icon, StorageBar, ToggleRow } from "@rl/ui";
import { AppShell } from "@/components/app-chrome";
import * as copy from "@/lib/copy";
import { RequireAuth } from "@/lib/session";
import type { ExamPackage } from "@rl/schemas";
import { getAllPackages } from "@/lib/exam/db";
import * as courseEngine from "@/lib/course/engine";
import {
  courseVideoBytes,
  manifestBytesOf,
  type CourseEngineState,
} from "@/lib/course/engine";
import { useCourseEngine } from "@/lib/course/use-engine";
import { fmtBytes, useDataSaver } from "../courses/course-shared";

const EYEBROW: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 800,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--color-ink-subtle)",
  marginTop: 2,
};

interface RemoveTarget {
  kind: "course" | "video";
  id: string; // courseId | assetPath
  title: string;
  bytes: number;
}

export default function DownloadsPage() {
  return (
    <RequireAuth>
      <DownloadsScreen />
    </RequireAuth>
  );
}

function DownloadsScreen() {
  const eng = useCourseEngine();
  const [dataSaver, setDataSaver] = useDataSaver();
  const [examPkgs, setExamPkgs] = useState<ExamPackage[]>([]);
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null);
  const [liveMsg, setLiveMsg] = useState("");

  /* exam packages surface here read-only (same shared DB) */
  useEffect(() => {
    let cancelled = false;
    void getAllPackages().then((pkgs) => {
      if (!cancelled) setExamPkgs(pkgs);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /* device storage estimate — refreshed whenever the inventory changes */
  useEffect(() => {
    let cancelled = false;
    void navigator.storage
      ?.estimate?.()
      .then((est) => {
        if (cancelled || !est) return;
        if (typeof est.usage === "number" && typeof est.quota === "number" && est.quota > 0) {
          setEstimate({ usage: est.usage, quota: est.quota });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [eng.assets, eng.manifests, examPkgs]);

  /* offline announcement */
  const firstStatus = useRef(true);
  useEffect(() => {
    if (!eng.ready) return;
    if (firstStatus.current) {
      firstStatus.current = false;
      return;
    }
    setLiveMsg(eng.online ? "Connected — downloads continue." : copy.syncCenter.downloadStalled);
  }, [eng.online, eng.ready]);

  /* Esc closes the dialog */
  useEffect(() => {
    if (!removeTarget) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRemoveTarget(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [removeTarget]);

  /* ----- real segment sizes ----- */
  const videosBytes = useMemo(
    () => Object.values(eng.assets).reduce((sum, a) => sum + a.sizeBytes, 0),
    [eng.assets],
  );
  const pagesBytes = useMemo(
    () => Object.values(eng.manifests).reduce((sum, m) => sum + manifestBytesOf(m), 0),
    [eng.manifests],
  );
  const examsBytes = useMemo(
    () => examPkgs.reduce((sum, p) => sum + JSON.stringify(p).length, 0),
    [examPkgs],
  );
  const appBytes = videosBytes + pagesBytes + examsBytes;
  const meterTotal = estimate?.quota ?? Math.max(appBytes, 1);
  const meterUsed = estimate?.usage ?? appBytes;
  const nearlyFull = eng.storageFull || (estimate !== null && meterUsed / meterTotal >= 0.8);

  if (!eng.ready) return null;

  const doRemove = async () => {
    if (!removeTarget) return;
    if (removeTarget.kind === "course") {
      await courseEngine.removeCourseContent(removeTarget.id);
    } else {
      await courseEngine.removeVideo(removeTarget.id);
    }
    setLiveMsg(`${removeTarget.title} removed — your progress and grades stay safe.`);
    setRemoveTarget(null);
  };

  /* active rows: manifest + video downloads currently in flight */
  const activeRows: { key: string; title: string; pct: number; stalled: boolean; sizeLabel: string }[] = [
    ...Object.entries(eng.downloads).map(([courseId, d]) => ({
      key: `course:${courseId}`,
      title: eng.courses.find((c) => c.id === courseId)?.title ?? "Course",
      pct: d.pct,
      stalled: d.stalled || !eng.online,
      sizeLabel: fmtBytes(eng.courses.find((c) => c.id === courseId)?.manifestBytes ?? 0),
    })),
    ...Object.entries(eng.videoDownloads).map(([assetPath, d]) => ({
      key: `video:${assetPath}`,
      title: videoTitle(assetPath, eng),
      pct: d.pct,
      stalled: d.stalled || !eng.online,
      sizeLabel: fmtBytes(d.totalBytes),
    })),
  ];

  const storedCourses = Object.values(eng.manifests);
  const storedVideos = Object.values(eng.assets);
  const shelfEmpty =
    storedCourses.length === 0 && storedVideos.length === 0 && examPkgs.length === 0;

  return (
    <AppShell>
      <style>{dlCss}</style>
      <div className="page-body dlm-root" style={{ padding: 16 }}>
        <span className="dlm-vh" aria-live="polite">
          {liveMsg}
        </span>

        <h1 style={{ fontSize: 19, fontWeight: 800, margin: 0 }}>Downloads &amp; storage</h1>

        {/* ----- storage meter — real bytes, device estimate when available ----- */}
        <div className="rl-card" style={{ borderWidth: 1.5, padding: "13px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, fontWeight: 700 }}>
            <span>This phone</span>
            <span
              className="rl-num"
              style={{ color: nearlyFull ? "var(--color-on-device-fg)" : "var(--color-synced-fg)" }}
            >
              {estimate
                ? `${fmtBytes(meterUsed)} of ${fmtBytes(meterTotal)} used`
                : `${fmtBytes(appBytes)} on this phone`}
            </span>
          </div>
          <StorageBar
            style={{ marginTop: 8 }}
            aria-label={`Storage: ${fmtBytes(videosBytes)} videos, ${fmtBytes(pagesBytes)} pages, ${fmtBytes(examsBytes)} exams`}
            segments={[
              { percent: (videosBytes / meterTotal) * 100, color: "var(--seg-videos)", label: "Videos" },
              { percent: (pagesBytes / meterTotal) * 100, color: "var(--seg-pages)", label: "Pages" },
              { percent: (examsBytes / meterTotal) * 100, color: "var(--seg-exams)", label: "Exams" },
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
            <LegendItem colorVar="--seg-videos" label={`Videos ${fmtBytes(videosBytes)}`} />
            <LegendItem colorVar="--seg-pages" label={`Pages ${fmtBytes(pagesBytes)}`} />
            <LegendItem colorVar="--seg-exams" label={`Exams ${fmtBytes(examsBytes)}`} />
          </div>
        </div>

        {/* ----- storage-full banner — amber from 80%, the shelf below is the tool ----- */}
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
              {copy.environment.storageFull} Removing a video below frees the most.
            </span>
          </div>
        ) : null}

        {/* ----- active downloads ----- */}
        <div style={EYEBROW}>Active</div>
        {activeRows.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--color-ink-subtle)", padding: "2px 2px" }}>
            Nothing downloading right now.
          </div>
        ) : (
          activeRows.map((row) => <ActiveRow key={row.key} row={row} />)
        )}

        {/* ----- the shelf ----- */}
        <div style={EYEBROW}>On this phone</div>

        {shelfEmpty ? (
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
            Nothing downloaded yet — courses and exams you download show up here.
          </div>
        ) : null}

        {storedCourses.map((stored) => {
          const m = stored.manifest;
          const bytes = manifestBytesOf(stored) + courseVideoBytes(m.courseId, eng);
          const hasExam = m.chapters.some((ch) =>
            ch.pages.some((p) => p.type === "assessment_embed"),
          );
          return (
            <div
              key={m.courseId}
              className="rl-card"
              style={{ borderWidth: 1.5, padding: "12px 14px", display: "flex", alignItems: "center", gap: 11 }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{m.title} — full course</div>
                <div className="rl-num" style={{ fontSize: 11, color: "var(--color-ink-subtle)", marginTop: 1 }}>
                  {fmtBytes(bytes)} · {m.chapters.length} chapters
                  {hasExam ? " · exam included" : ""}
                </div>
              </div>
              <button
                type="button"
                className="dlm-link"
                style={{ color: "var(--color-ink-subtle)" }}
                onClick={() =>
                  setRemoveTarget({ kind: "course", id: m.courseId, title: m.title, bytes })
                }
              >
                Remove…
              </button>
            </div>
          );
        })}

        {storedVideos.map((asset) => (
          <div
            key={asset.assetPath}
            className="rl-card"
            style={{ borderWidth: 1.5, padding: "12px 14px", display: "flex", alignItems: "center", gap: 11 }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{videoTitle(asset.assetPath, eng)}</div>
              <div className="rl-num" style={{ fontSize: 11, color: "var(--color-ink-subtle)", marginTop: 1 }}>
                {fmtBytes(asset.sizeBytes)} · on this phone
              </div>
            </div>
            <button
              type="button"
              className="dlm-link"
              style={{ color: "var(--color-ink-subtle)" }}
              onClick={() =>
                setRemoveTarget({
                  kind: "video",
                  id: asset.assetPath,
                  title: videoTitle(asset.assetPath, eng),
                  bytes: asset.sizeBytes,
                })
              }
            >
              Remove…
            </button>
          </div>
        ))}

        {examPkgs.map((pkg) => (
          <div
            key={pkg.examId}
            className="rl-card"
            style={{ borderWidth: 1.5, padding: "12px 14px", display: "flex", alignItems: "center", gap: 11 }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{pkg.title} — exam</div>
              <div className="rl-num" style={{ fontSize: 11, color: "var(--color-ink-subtle)", marginTop: 1 }}>
                {fmtBytes(JSON.stringify(pkg).length)} · stays until the exam window closes
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
      {removeTarget ? (
        <>
          <div className="scrim" onClick={() => setRemoveTarget(null)} aria-hidden />
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dlm-remove-title">
            <div id="dlm-remove-title" style={{ fontSize: 14.5, fontWeight: 800 }}>
              Remove {removeTarget.title} from this phone?
            </div>
            <div
              style={{ fontSize: 12.5, color: "var(--color-ink-secondary)", lineHeight: 1.55, marginTop: 6 }}
            >
              Frees {fmtBytes(removeTarget.bytes)}.{" "}
              <b style={{ color: "var(--color-ink)" }}>Your progress, quiz answers, and grades stay safe</b>{" "}
              — only the content leaves. You can download it again anytime.
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button type="button" className="dlm-keep" onClick={() => setRemoveTarget(null)} autoFocus>
                Keep
              </button>
              <Button
                variant="destructive"
                style={{ flex: 1, height: 44, fontSize: 13, fontWeight: 800 }}
                onClick={() => void doRemove()}
              >
                Remove · {fmtBytes(removeTarget.bytes)}
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </AppShell>
  );
}

/** "Ch. 3 video — Community preparedness" — located in the stored manifests. */
function videoTitle(assetPath: string, eng: CourseEngineState): string {
  for (const stored of Object.values(eng.manifests)) {
    for (const chapter of stored.manifest.chapters) {
      for (const page of chapter.pages) {
        if (page.video?.assetPath === assetPath) {
          return `Ch. ${chapter.seq} video — ${page.title}`;
        }
      }
    }
  }
  return "Course video";
}

/* ---------- one active row: running / stalled ---------- */

function ActiveRow({
  row,
}: {
  row: { title: string; pct: number; stalled: boolean; sizeLabel: string };
}) {
  return (
    <div
      className={row.stalled ? "rl-card" : "dlm-active"}
      style={{
        borderWidth: 1.5,
        padding: "12px 13px",
        display: "flex",
        alignItems: "center",
        gap: 11,
        borderStyle: "solid",
        borderRadius: 14,
        background: "var(--color-card)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5, fontWeight: 600 }}>
          <span>{row.title}</span>
          <span
            className="rl-num"
            style={{ color: row.stalled ? "var(--color-on-device-fg)" : "var(--color-primary)" }}
          >
            {Math.round(row.pct)}% {row.stalled ? "kept" : `· ${row.sizeLabel}`}
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
          aria-valuenow={Math.round(row.pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${row.title} download`}
        >
          <div
            style={{
              width: `${row.pct}%`,
              height: "100%",
              background: row.stalled ? "var(--color-on-device-solid)" : "var(--color-primary)",
              borderRadius: 3,
            }}
          />
        </div>
        {row.stalled ? (
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
.dlm-keep{flex:1;height:44px;border:1.5px solid var(--color-border);color:var(--color-ink-subtle);background:var(--color-card);border-radius:999px;font-family:inherit;font-size:13px;font-weight:800;cursor:pointer;}
`;
