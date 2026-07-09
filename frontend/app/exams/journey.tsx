"use client";

/**
 * Exam journey — the REAL offline-first experience. Same stage machine as
 * the design prototype (list → detail → taking → review → submitted →
 * status → recovery) with the same overlays and microcopy, but the engine
 * underneath is real:
 *   · GET /exams drives the list (IndexedDB packages are the calm fallback);
 *   · answers encrypt at write time (envelope) and persist to IndexedDB
 *     atomically with their outbox event;
 *   · the outbox drips to POST /sync/batch (~30s / online / visibility);
 *   · the timer anchors to the server's deadlineAt wall clock;
 *   · results come from GET /attempts/:id polling.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Button,
  Chip,
  Icon,
  Popover,
  SyncPill,
  TimerPill,
  Toast,
  type TimerPhase,
  type WorkState,
} from "@rl/ui";
import * as copy from "@/lib/copy";
import { getErrorMessage, NO_CONNECTION_MESSAGE } from "@/lib/api";
import { useDesktop } from "@/lib/hotkeys";
import { initialsOf, useSession } from "@/lib/session";
import * as engine from "@/lib/exam/engine";
import { countAnswered, type UiExamItem } from "@/lib/exam/engine";
import { useExamEngine } from "@/lib/exam/use-engine";
import { AppShell } from "@/components/app-chrome";
import { takeExamTarget } from "../courses/course-shared";
import { SyncCenterContent } from "./sync-center";
import {
  fmtClock,
  fmtClosesHint,
  fmtLongDate,
  fmtOpensHint,
  fmtSize,
  splitTitle,
  strings,
  type Answer,
} from "./state";
import {
  ArrowRight,
  BackCircle,
  BatteryLowIcon,
  card,
  ChevronLeft,
  DialogShell,
  PaletteGrid,
  srOnly,
  StatCol,
  SUB,
  TimelineStep,
  useWide,
  type StepKind,
} from "./bits";

type Stage =
  | "list"
  | "detail"
  | "taking"
  | "review"
  | "submitted"
  | "status"
  | "recovery";

interface Overlays {
  palette: boolean;
  sync: boolean;
  submitConfirm: boolean;
  leave: boolean;
  dlConfirm: boolean;
}

const NO_OVERLAYS: Overlays = {
  palette: false,
  sync: false,
  submitConfirm: false,
  leave: false,
  dlConfirm: false,
};

const SUBMITTED_STATES = ["submitted", "grading", "graded"] as const;

function isSubmittedish(item: UiExamItem, att?: { state: string }): boolean {
  if (att?.state === "submitted") return true;
  return (SUBMITTED_STATES as readonly string[]).includes(item.attemptState);
}

/** iOS has no Background Sync API — sending pauses when the app closes. */
function isIOSNoBackgroundSync(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return false;
  }
  const iosUA =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return iosUA && !("SyncManager" in window);
}

interface BatteryLike {
  level: number;
  charging: boolean;
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
}

/** Battery API is Chromium-only — the banner simply never shows elsewhere. */
function useBatteryLow(): boolean {
  const [low, setLow] = useState(false);
  useEffect(() => {
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<BatteryLike>;
    };
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    nav
      .getBattery?.()
      .then((battery) => {
        if (cancelled) return;
        const update = () => setLow(battery.level <= 0.2 && !battery.charging);
        update();
        battery.addEventListener("levelchange", update);
        battery.addEventListener("chargingchange", update);
        cleanup = () => {
          battery.removeEventListener("levelchange", update);
          battery.removeEventListener("chargingchange", update);
        };
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);
  return low;
}

export function ExamJourney() {
  const eng = useExamEngine();
  const { user } = useSession();
  const wide = useWide();
  /** ≥1080px — desktop LAB MODE (exl-a): docked palette rail + lab top bar. */
  const lab = useDesktop();
  const batteryLow = useBatteryLow();

  const [stage, setStageRaw] = useState<Stage | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ov, setOv] = useState<Overlays>(NO_OVERLAYS);
  const [toast, setToast] = useState("");
  const [announce, setAnnounce] = useState("");
  /** Volatile plaintext echo (session memory only — never persisted). */
  const [echo, setEcho] = useState<Record<string, string>>({});
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [starting, setStarting] = useState(false);
  const [ios, setIos] = useState(false);
  useEffect(() => setIos(isIOSNoBackgroundSync()), []);

  const shortName = user?.fullName.trim().split(/\s+/)[0] ?? "there";
  const offline = !eng.online;
  const dark =
    typeof document !== "undefined" &&
    document.documentElement.dataset.theme === "dark";

  /* ----- toast: 1600ms, a new toast resets the clock ----- */
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 1600);
  }, []);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  /* ----- hydrate: in_progress attempt in IndexedDB → crash recovery ----- */
  useEffect(() => {
    if (!eng.ready || stage !== null) return;
    if (eng.recoveryExamId && eng.packages[eng.recoveryExamId]) {
      setSelectedId(eng.recoveryExamId);
      setStageRaw("recovery");
    } else {
      setStageRaw("list");
    }
  }, [eng.ready, eng.recoveryExamId, eng.packages, stage]);

  /* ----- deep link from the course player's assessment embed -----
     The exam id rides sessionStorage (or ?exam=) so course URLs stay
     query-free for the SW cache. Consumed once; recovery always wins. */
  const deepLink = useRef<string | null>(null);
  useEffect(() => {
    if (deepLink.current !== null) return;
    const fromQuery = new URLSearchParams(window.location.search).get("exam");
    deepLink.current = fromQuery ?? takeExamTarget() ?? "consumed";
  }, []);
  useEffect(() => {
    if (!eng.ready || (stage !== null && stage !== "list")) return;
    if (eng.recoveryExamId && eng.packages[eng.recoveryExamId]) return;
    const id = deepLink.current;
    if (!id || id === "consumed") return;
    const target = eng.exams.find((e) => e.id === id);
    if (!target && !eng.packages[id]) return; // list may still be loading
    deepLink.current = "consumed";
    setSelectedId(id);
    setOv(NO_OVERLAYS);
    setStageRaw(
      target && isSubmittedish(target, eng.attempts[id]) ? "status" : "detail",
    );
  }, [eng.ready, eng.exams, eng.packages, eng.attempts, eng.recoveryExamId, stage]);

  /* ----- 1s wall-clock tick (timer + auto-submit anchor to deadlineAt) ----- */
  useEffect(() => {
    if (!eng.ready) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [eng.ready]);

  /* ----- selected exam ----- */
  const item = selectedId
    ? (eng.exams.find((e) => e.id === selectedId) ?? null)
    : null;
  const pkg = selectedId ? (eng.packages[selectedId] ?? null) : null;
  const att = selectedId ? (eng.attempts[selectedId] ?? null) : null;

  const questions = useMemo(
    () => (pkg ? [...pkg.questions].sort((a, b) => a.seq - b.seq) : []),
    [pkg],
  );
  const total = questions.length || (item?.totalItems ?? 0);
  const cur = Math.max(0, Math.min(att?.currentIndex ?? 0, Math.max(0, questions.length - 1)));

  const remaining =
    att && att.state === "in_progress"
      ? Math.max(0, Math.floor((Date.parse(att.deadlineAt) - nowMs) / 1000))
      : 0;

  const answeredCount = att ? countAnswered(att) : 0;
  const attemptOutbox = att ? eng.outbox.byAttempt[att.attemptId] : undefined;
  const answersPending =
    att?.state === "submitted" ? (attemptOutbox?.pendingAnswers ?? 0) : 0;
  const submitPending =
    att?.state === "submitted" ? (attemptOutbox?.submitPending ?? false) : false;
  const attemptAllSent =
    att?.state === "submitted" && answersPending === 0 && !submitPending;
  const sentCount = Math.max(0, answeredCount - answersPending);
  const selStatus = att
    ? eng.statuses[att.attemptId]
    : item?.attemptId
      ? eng.statuses[item.attemptId]
      : undefined;
  const gradedScore = selStatus?.score ?? item?.score ?? null;

  const flaggedIds = att?.flags ?? [];
  const paletteAnswers: Answer[] = questions.map((q) => {
    const echoVal = echo[q.id];
    if (echoVal !== undefined) return echoVal === "" ? null : echoVal;
    const rec = att?.answers[q.id];
    return rec?.hasValue ? (rec.display ?? "answered") : null;
  });
  const paletteFlags = questions.map((q) => flaggedIds.includes(q.id));
  const paletteAnswered = paletteAnswers.filter(
    (a) => a !== null && a !== "",
  ).length;

  /* ----- deadline watcher: local-first auto-submit at 0 (any attempt) ----- */
  const autoSubmitted = useRef(new Set<string>());
  useEffect(() => {
    if (!eng.ready) return;
    for (const attempt of Object.values(eng.attempts)) {
      if (attempt.state !== "in_progress") continue;
      if (Date.parse(attempt.deadlineAt) - nowMs > 0) continue;
      if (autoSubmitted.current.has(attempt.attemptId)) continue;
      autoSubmitted.current.add(attempt.attemptId);
      void engine.submitAttempt(attempt.examId);
      if (
        attempt.examId === selectedId &&
        (stage === "taking" || stage === "review" || stage === "recovery")
      ) {
        setOv(NO_OVERLAYS);
        setStageRaw("submitted");
      }
      showToast(strings.toastTimesUp);
    }
  }, [nowMs, eng.ready, eng.attempts, selectedId, stage, showToast]);

  /* ----- screen-reader milestones at 10:00 / 5:00 / 1:00 only ----- */
  const prevRemaining = useRef<number | null>(null);
  useEffect(() => {
    if (stage !== "taking" || !att || att.state !== "in_progress") {
      prevRemaining.current = null;
      return;
    }
    const prev = prevRemaining.current;
    if (prev !== null) {
      for (const mark of [600, 300, 60]) {
        if (prev > mark && remaining <= mark) setAnnounce(`${mark / 60} min left`);
      }
    }
    prevRemaining.current = remaining;
  }, [stage, att, remaining]);

  /* ----- status polling while submitted work is out for grading ----- */
  useEffect(() => {
    if (!eng.ready || offline) return;
    const ids = new Set<string>();
    for (const attempt of Object.values(eng.attempts)) {
      if (
        attempt.state === "submitted" &&
        eng.statuses[attempt.attemptId]?.state !== "graded"
      ) {
        ids.add(attempt.attemptId);
      }
    }
    if (
      item?.attemptId &&
      !att &&
      (item.attemptState === "submitted" || item.attemptState === "grading") &&
      eng.statuses[item.attemptId]?.state !== "graded"
    ) {
      ids.add(item.attemptId);
    }
    if (ids.size === 0) return;
    const poll = () => {
      for (const id of ids) void engine.pollAttemptStatus(id);
    };
    poll();
    const timer = setInterval(poll, 3000);
    return () => clearInterval(timer);
  }, [eng.ready, offline, eng.attempts, eng.statuses, item, att]);

  /* ----- Esc closes any overlay ----- */
  const anyOverlay =
    ov.palette || ov.sync || ov.submitConfirm || ov.leave || ov.dlConfirm;
  useEffect(() => {
    if (!anyOverlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOv(NO_OVERLAYS);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [anyOverlay]);

  /* ----- lab-mode marker: suppresses global nav shortcuts mid-exam ----- */
  useEffect(() => {
    if (stage !== "taking") return;
    document.body.dataset.labMode = "1";
    return () => {
      delete document.body.dataset.labMode;
    };
  }, [stage]);

  /* ----- question focus + scroll reset on navigation ----- */
  const stemRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (stage !== "taking") return;
    scrollRef.current?.scrollTo({ top: 0 });
    stemRef.current?.focus();
  }, [stage, cur]);

  /* ----- actions ----- */
  const closeOv = useCallback(() => setOv(NO_OVERLAYS), []);
  const go = useCallback((s: Stage) => {
    setOv(NO_OVERLAYS);
    setStageRaw(s);
  }, []);
  const openExam = (e: UiExamItem) => {
    setSelectedId(e.id);
    setOv(NO_OVERLAYS);
    setStageRaw(isSubmittedish(e, eng.attempts[e.id]) ? "status" : "detail");
  };
  const pickOption = (questionId: string, optionId: string) => {
    if (!selectedId) return;
    setEcho((prev) => ({ ...prev, [questionId]: optionId }));
    engine.answerQuestion(selectedId, questionId, optionId, optionId);
    showToast(strings.toastSaved);
  };
  const identChange = (questionId: string, text: string) => {
    if (!selectedId) return;
    setEcho((prev) => ({ ...prev, [questionId]: text }));
    // Free text is encrypted before it ever touches IndexedDB (display: null).
    engine.answerQuestion(selectedId, questionId, text, null);
  };
  const toggleFlag = (questionId: string) => {
    if (!selectedId || !att) return;
    const on = !att.flags.includes(questionId);
    void engine.toggleFlag(selectedId, questionId);
    showToast(on ? strings.toastFlagged : strings.toastUnflagged);
  };
  const jumpTo = (i: number) => {
    setOv(NO_OVERLAYS);
    if (selectedId) void engine.setCurrentIndex(selectedId, i);
    setStageRaw("taking");
  };
  const startExam = async () => {
    if (!selectedId || starting) return;
    if (offline) {
      // Calm: starting needs the school clock; nothing on this phone is lost.
      showToast(NO_CONNECTION_MESSAGE);
      return;
    }
    setStarting(true);
    try {
      await engine.startAttempt(selectedId);
      setEcho({});
      go("taking");
    } catch (err) {
      showToast(getErrorMessage(err));
    } finally {
      setStarting(false);
    }
  };
  const doSubmitNow = useCallback(async () => {
    setOv(NO_OVERLAYS);
    if (selectedId) await engine.submitAttempt(selectedId);
    setStageRaw("submitted");
  }, [selectedId]);
  const sendNow = async () => {
    if (offline) return;
    setOv(NO_OVERLAYS);
    const left = await engine.sendNow();
    if (left === 0) showToast(strings.toastAllSent);
  };

  /* ----- exam keyboard (KEYS spec): 1–4/A–D answer · ←/→ move · F flag ·
     P focus palette · Enter next/review. Never while typing (ident input),
     never with a modifier, never while an overlay is open. ----- */
  useEffect(() => {
    if (stage !== "taking" || anyOverlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const q = questions[cur];
      if (!q) return;
      const onControl = t instanceof HTMLButtonElement || t instanceof HTMLAnchorElement;

      if (e.key === "ArrowLeft") {
        if (cur > 0 && selectedId) {
          e.preventDefault();
          void engine.setCurrentIndex(selectedId, cur - 1);
        }
        return;
      }
      if (e.key === "ArrowRight") {
        if (cur < total - 1 && selectedId) {
          e.preventDefault();
          void engine.setCurrentIndex(selectedId, cur + 1);
        }
        return;
      }
      if (e.key === "Enter") {
        if (onControl) return; // focused buttons own Enter
        e.preventDefault();
        if (cur === total - 1) go("review");
        else if (selectedId) void engine.setCurrentIndex(selectedId, cur + 1);
        return;
      }
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        toggleFlag(q.id);
        return;
      }
      if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        if (wide || lab) {
          document.querySelector<HTMLElement>("[data-palette-rail] .rl-navcell")?.focus();
        } else {
          setOv({ ...NO_OVERLAYS, palette: true });
        }
        return;
      }
      if (q.type !== "ident" && q.options && q.options.length > 0) {
        let idx = -1;
        if (/^[1-4]$/.test(e.key)) idx = Number(e.key) - 1;
        else if (/^[a-dA-D]$/.test(e.key)) idx = e.key.toLowerCase().charCodeAt(0) - 97;
        if (idx >= 0 && idx < q.options.length) {
          e.preventDefault();
          pickOption(q.id, q.options[idx]!.id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ----- derived (pill) ----- */
  const pendAll = eng.outbox.pending;
  const pillState: WorkState =
    pendAll === 0 ? "synced" : !offline ? "sending" : "on-device";
  const pillLabel =
    pillState === "synced"
      ? copy.syncCenter.pillAllSent
      : pillState === "sending"
        ? strings.sendingLeft(pendAll)
        : copy.syncCenter.pillResting(pendAll);

  /* ================= shared chrome bar ================= */

  const chromeBar = (title: string, onBack?: () => void) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "12px 16px 10px",
        position: "sticky",
        top: 0,
        zIndex: 20,
        background: "var(--color-canvas)",
      }}
    >
      {onBack ? <BackCircle label="Back" onClick={onBack} /> : null}
      <h1 style={{ flex: 1, fontSize: 19, fontWeight: 800, margin: 0 }}>{title}</h1>
      <span style={{ position: "relative", display: "inline-flex" }}>
        <SyncPill
          as="button"
          chrome
          state={pillState}
          label={pillLabel}
          offline={offline}
          aria-haspopup="dialog"
          onClick={() => setOv({ ...NO_OVERLAYS, sync: !ov.sync })}
          style={{ cursor: "pointer", border: "none", fontFamily: "inherit" }}
        />
        {/* dsk-d: at ≥720dp the Sync Center anchors to the pill with a caret */}
        {wide ? (
          <Popover open={ov.sync} onClose={closeOv} aria-label="Sync Center" width={340}>
            <SyncCenterContent
              eng={eng}
              onSendNow={() => void sendNow()}
              device={lab ? "computer" : "phone"}
            />
          </Popover>
        ) : null}
      </span>
    </div>
  );

  const frame = (children: ReactNode) => (
    <div
      style={{
        minHeight: "100dvh",
        maxWidth: lab ? 680 : 480,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {children}
    </div>
  );

  /* ================= screen: exam list ================= */

  const listChipFor = (e: UiExamItem): ReactNode => {
    const a = eng.attempts[e.id];
    const stored = Boolean(eng.packages[e.id]);
    const submitted = isSubmittedish(e, a);
    if (!submitted) {
      if (stored) {
        return (
          <Chip tone="synced" size="compact" icon={<Icon name="phone-check" size={12} />}>
            Ready on this phone — works with no signal
          </Chip>
        );
      }
      if (eng.downloads[e.id]) return null; // progress lives on the Detail screen
      return (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: "var(--color-primary)",
            fontSize: 12.5,
            fontWeight: 700,
          }}
        >
          <Icon name="download" size={14} />
          Download to take offline · {fmtSize(e.packageBytes)}
        </span>
      );
    }
    const score = a ? (eng.statuses[a.attemptId]?.score ?? e.score) : e.score;
    const ob = a ? eng.outbox.byAttempt[a.attemptId] : undefined;
    const pend = ob?.pendingAnswers ?? 0;
    const allSent = pend === 0 && !ob?.submitPending;
    if (score || allSent) {
      return (
        <Chip tone="synced" size="compact" icon={<Icon name="cloud-check" size={13} />}>
          {score ? `Graded · ${score}` : "At school · awaiting grading"}
        </Chip>
      );
    }
    if (!offline) {
      const answered = a ? countAnswered(a) : pend;
      return (
        <Chip tone="sending" size="compact" icon={<Icon name="send" size={12} />}>
          Sending to school · {Math.max(0, answered - pend)} of {answered}
        </Chip>
      );
    }
    return (
      <Chip tone="on-device" size="compact" icon={<Icon name="phone-check" size={12} />}>
        Submitted · {pend} answers to send
      </Chip>
    );
  };

  const renderList = () => {
    const items = eng.exams;
    const today = items.filter(
      (e) =>
        Date.parse(e.closesAt) > nowMs &&
        (e.cached || Date.parse(e.opensAt) <= nowMs),
    );
    const upcoming = items.filter(
      (e) => !e.cached && Date.parse(e.opensAt) > nowMs,
    );
    const finished = items.filter((e) => Date.parse(e.closesAt) <= nowMs);
    const badge = today.filter((e) => !isSubmittedish(e, eng.attempts[e.id])).length;

    return (
      <AppShell examBadge={badge > 0 ? badge : undefined}>
        {chromeBar("Exams")}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 16px 20px" }}>
          {items.length === 0 ? (
            <div style={{ ...card, padding: "14px 15px", marginTop: 6 }}>
              <div style={{ fontSize: 15.5, fontWeight: 700 }}>No exams yet</div>
              <div style={{ fontSize: 12.5, color: SUB, marginTop: 3 }}>
                {offline
                  ? "You’re offline — anything saved on this phone still works."
                  : "New exams from your teacher will show up here."}
              </div>
            </div>
          ) : null}

          {today.length > 0 ? (
            <>
              <div className="rl-overline" style={{ marginTop: 6 }}>
                Today
              </div>
              {today.map((e) => {
                const chip = listChipFor(e);
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => openExam(e)}
                    style={{
                      ...card,
                      padding: "14px 15px",
                      textAlign: "left",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      color: "inherit",
                      width: "100%",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <div style={{ flex: 1, fontSize: 15.5, fontWeight: 700 }}>{e.title}</div>
                      <div style={{ fontSize: 11.5, color: SUB, flex: "none" }}>
                        {fmtClosesHint(e.closesAt, nowMs)}
                      </div>
                    </div>
                    <div style={{ fontSize: 12.5, color: SUB, marginTop: 3 }}>
                      {e.totalItems} items · {e.durationMinutes} min · one attempt
                    </div>
                    {chip ? <div style={{ marginTop: 10 }}>{chip}</div> : null}
                  </button>
                );
              })}
            </>
          ) : null}

          {upcoming.length > 0 ? (
            <>
              <div className="rl-overline" style={{ marginTop: 8 }}>
                Coming up
              </div>
              {upcoming.map((e) => (
                <div key={e.id} style={{ ...card, padding: "14px 15px", opacity: 0.75 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <div style={{ flex: 1, fontSize: 15.5, fontWeight: 700 }}>{e.title}</div>
                    <div style={{ fontSize: 11.5, color: SUB, flex: "none" }}>
                      {fmtOpensHint(e.opensAt, nowMs)}
                    </div>
                  </div>
                  <div style={{ fontSize: 12.5, color: SUB, marginTop: 3 }}>
                    Your teacher will release this on {fmtLongDate(e.opensAt)}. You&rsquo;ll be
                    able to download it early.
                  </div>
                </div>
              ))}
            </>
          ) : null}

          {finished.length > 0 ? (
            <>
              <div className="rl-overline" style={{ marginTop: 8 }}>
                Finished
              </div>
              {finished.map((e) => {
                const submitted = isSubmittedish(e, eng.attempts[e.id]);
                const inner = (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1, fontSize: 15.5, fontWeight: 700 }}>{e.title}</div>
                    {submitted ? listChipFor(e) : null}
                  </div>
                );
                return submitted ? (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => openExam(e)}
                    style={{
                      ...card,
                      padding: "14px 15px",
                      textAlign: "left",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      color: "inherit",
                      width: "100%",
                    }}
                  >
                    {inner}
                  </button>
                ) : (
                  <div key={e.id} style={{ ...card, padding: "14px 15px" }}>
                    {inner}
                  </div>
                );
              })}
            </>
          ) : null}
        </div>
      </AppShell>
    );
  };

  /* ================= screen: exam detail ================= */

  const renderDetail = () => {
    if (!selectedId) return null;
    const info = item ?? (pkg
      ? {
          title: pkg.title,
          totalItems: pkg.questions.length,
          durationMinutes: pkg.durationMinutes,
          packageBytes: 0,
        }
      : null);
    if (!info) return null;
    const titleBits = splitTitle(info.title);
    const download = eng.downloads[selectedId];
    const dlState: "none" | "downloading" | "ready" = pkg
      ? "ready"
      : download
        ? "downloading"
        : "none";
    const size = fmtSize(info.packageBytes);
    const dlBorder = dark ? "#2C4270" : "#ADC4F5";

    return frame(
      <>
        {chromeBar("Exam details", () => go("list"))}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 16px 20px" }}>
          <div style={card}>
            <div className="rl-overline">{titleBits.over}</div>
            <div style={{ fontSize: 19, fontWeight: 800, marginTop: 4 }}>{titleBits.head}</div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 14,
                fontSize: 13,
                color: SUB,
                marginTop: 12,
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Icon name="clock" size={15} />
                {info.durationMinutes} minutes
              </span>
              <span>{info.totalItems} items</span>
              <span>one attempt</span>
            </div>
          </div>

          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 800 }}>Instructions</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.55, color: SUB, marginTop: 6 }}>
              Answer all items. Multiple choice and true/false: pick one answer. Identification:
              spelling matters. The timer starts when you begin and keeps running if you leave.
            </div>
          </div>

          {dlState === "none" ? (
            <div style={card}>
              <div style={{ fontSize: 13, fontWeight: 800 }}>Take it offline</div>
              <div style={{ fontSize: 13, lineHeight: 1.5, color: SUB, marginTop: 5 }}>
                Download once — then the whole exam works with no signal. Nothing else downloads
                without asking you.
              </div>
              <Button
                icon="download"
                iconSize={16}
                style={{ width: "100%", height: 52, marginTop: 12, fontSize: 15, fontWeight: 700 }}
                onClick={() => setOv({ ...NO_OVERLAYS, dlConfirm: true })}
              >
                Download exam · {size}
              </Button>
            </div>
          ) : null}

          {dlState === "downloading" ? (
            <div style={{ ...card, borderColor: dlBorder }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 13,
                  fontWeight: 700,
                  color: "var(--color-sending-fg)",
                }}
              >
                <span>Downloading exam…</span>
                <span className="rl-num">{download?.pct ?? 0}%</span>
              </div>
              <div
                style={{
                  height: 8,
                  background: "var(--color-sending-bg)",
                  borderRadius: 4,
                  overflow: "hidden",
                  marginTop: 9,
                }}
                role="progressbar"
                aria-valuenow={download?.pct ?? 0}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${download?.pct ?? 0}%`,
                    background: "var(--color-primary)",
                    borderRadius: 4,
                  }}
                />
              </div>
              {offline || download?.stalled ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    marginTop: 9,
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: "var(--color-on-device-fg)",
                  }}
                >
                  <Icon name="no-signal" size={14} />
                  {copy.syncCenter.downloadStalled}
                </div>
              ) : null}
            </div>
          ) : null}

          {dlState === "ready" ? (
            <>
              <div
                style={{
                  background: "var(--color-synced-bg)",
                  border: "1.5px solid var(--color-success-border)",
                  borderRadius: 14,
                  padding: 15,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 14,
                    fontWeight: 800,
                    color: "var(--color-synced-fg)",
                  }}
                >
                  <Icon name="phone-check" size={16} />
                  Exam is on this phone
                </div>
                <div
                  style={{
                    fontSize: 13,
                    lineHeight: 1.5,
                    color: "var(--color-synced-fg)",
                    marginTop: 4,
                  }}
                >
                  You can take it with zero signal. Answers save on this phone as you go.
                </div>
              </div>
              <Button
                size="exam"
                disabled={starting}
                style={{ width: "100%", fontSize: 16, fontWeight: 800 }}
                onClick={att?.state === "in_progress" ? () => go("taking") : () => void startExam()}
              >
                {att?.state === "in_progress" ? "Continue exam" : "Start exam"}
              </Button>
            </>
          ) : null}
        </div>
      </>,
    );
  };

  /* ================= screen: taking ================= */

  const renderTaking = () => {
    if (!pkg || !att || att.state !== "in_progress") return null;
    const q = questions[cur];
    if (!q) return null;
    const rec = att.answers[q.id];
    const echoVal = echo[q.id];
    const identText = echoVal ?? "";
    const answeredHere =
      echoVal !== undefined ? echoVal !== "" : (rec?.hasValue ?? false);
    const selectedOpt = echoVal !== undefined ? echoVal : (rec?.display ?? null);
    const flagged = flaggedIds.includes(q.id);
    const phase: TimerPhase =
      remaining < 60 ? "critical" : remaining < 300 ? "warning" : "normal";
    const tLabel =
      phase === "critical"
        ? "almost up — auto-submits"
        : phase === "warning"
          ? copy.exam.timerFiveMin
          : "time left";

    const questionBlock =
      q.type === "ident" ? (
        <div>
          <label
            htmlFor="ident-answer"
            ref={(el) => {
              stemRef.current = el;
            }}
            tabIndex={-1}
            style={{
              display: "block",
              fontSize: 19,
              fontWeight: 700,
              lineHeight: 1.42,
              outline: "none",
            }}
          >
            {cur + 1}. {q.text}
          </label>
          <input
            id="ident-answer"
            className="rl-input"
            value={identText}
            onChange={(e) => identChange(q.id, e.target.value)}
            placeholder="Type your answer"
            maxLength={40}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            style={{ height: 52, fontSize: 16, marginTop: 14, borderWidth: 2, borderRadius: 12 }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 7 }}>
            <span style={{ fontSize: 12, color: SUB }}>
              Spelling matters — your teacher checks the exact answer.
            </span>
            <span className="rl-num" style={{ fontSize: 11, color: "var(--color-ink-faint)", flexShrink: 0 }}>
              {identText.length}/40
            </span>
          </div>
        </div>
      ) : (
        <fieldset style={{ border: "none", margin: 0, padding: 0, minWidth: 0 }}>
          <legend
            ref={(el) => {
              stemRef.current = el;
            }}
            tabIndex={-1}
            style={{ fontSize: 19, fontWeight: 700, lineHeight: 1.42, padding: 0, outline: "none" }}
          >
            {cur + 1}. {q.text}
          </legend>
          <div style={{ display: "flex", flexDirection: "column", gap: lab ? 11 : 10, marginTop: 14 }}>
            {(q.options ?? []).map((opt, oi) => {
              const selected = selectedOpt === opt.id;
              return (
                <label
                  key={opt.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    minHeight: lab ? 56 : 54,
                    padding: "13px 15px",
                    borderRadius: 14,
                    cursor: "pointer",
                    background: selected ? "var(--color-primary-selected)" : "var(--color-card)",
                    border: selected
                      ? "2px solid var(--color-primary)"
                      : "1.5px solid var(--color-border)",
                    boxShadow:
                      selected && !dark ? "0 2px 6px rgba(30,74,194,0.10)" : undefined,
                  }}
                >
                  <input
                    type="radio"
                    name={`q-${cur}`}
                    checked={selected}
                    onChange={() => pickOption(q.id, opt.id)}
                    style={srOnly}
                  />
                  {lab ? (
                    /* letter chip (A–D) — keyboard 1–4 / A–D select (exl-a) */
                    <span
                      aria-hidden
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 7,
                        border: `1.5px solid ${selected ? "var(--color-primary)" : "var(--color-checkbox-border)"}`,
                        color: selected ? "var(--color-primary)" : "var(--color-ink-subtle)",
                        background: "var(--color-card)",
                        fontSize: 12,
                        fontWeight: 800,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      {String.fromCharCode(65 + oi)}
                    </span>
                  ) : selected ? (
                    <span
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        background: "var(--color-primary)",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#fff" }} />
                    </span>
                  ) : (
                    <span
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        border: "2px solid var(--color-ink-subtle)",
                        opacity: 0.75,
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <span style={{ flex: 1, fontSize: 16, lineHeight: 1.35, fontWeight: selected ? 600 : 400 }}>
                    {opt.text}
                  </span>
                  {selected ? (
                    <span
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: "50%",
                        background: "var(--color-primary)",
                        color: "#fff",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <Icon name="check" size={13} />
                    </span>
                  ) : null}
                </label>
              );
            })}
          </div>
        </fieldset>
      );

    const savedChip = (
      <div aria-live="polite" style={{ marginTop: 12 }}>
        {answeredHere ? (
          <Chip
            tone="synced"
            icon={<Icon name="check" size={14} />}
            style={{ padding: "6px 12px", fontSize: 12.5 }}
          >
            {copy.exam.answerSaved.en}
          </Chip>
        ) : null}
      </div>
    );

    /* ================= LAB MODE (≥1080px, exl-a) ================= */
    if (lab) {
      const labTLabel =
        phase === "critical" ? "almost up" : phase === "warning" ? copy.exam.timerFiveMin : "time left";
      return (
        <div
          style={{
            height: "100dvh",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            background: "var(--color-canvas)",
          }}
        >
          <style>{`.exl-timer{padding:8px 20px;} .exl-timer .rl-timer__value{font-size:22px;}`}</style>

          {/* lab top bar — replaces all chrome; no navigation away mid-exam */}
          <div
            style={{
              background: "var(--color-card)",
              borderBottom: "1px solid var(--color-border)",
              padding: "11px 22px",
              display: "flex",
              alignItems: "center",
              gap: 16,
              flexShrink: 0,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 34,
                height: 34,
                borderRadius: "50%",
                border: "1.5px solid var(--color-primary)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 6,
                fontFamily: "ui-monospace, Menlo, monospace",
                color: "var(--color-ink-subtle)",
                flexShrink: 0,
              }}
            >
              DepEd
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {pkg.title}
              </div>
              <div style={{ fontSize: 11, color: SUB, marginTop: 1 }}>
                {user?.scopeName ?? "Your school"} · exam in progress
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
              <TimerPill className="exl-timer" value={fmtClock(remaining)} phase={phase} label={labTLabel} />
              <Chip tone="on-device" size="compact" icon={<Icon name="phone-check" size={13} />}>
                Saved on this device
              </Chip>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  background: "var(--color-canvas)",
                  border: "1.5px solid var(--color-border)",
                  borderRadius: 999,
                  padding: "5px 12px 5px 5px",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: "var(--color-primary)",
                    color: "#fff",
                    fontSize: 11,
                    fontWeight: 800,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {user ? initialsOf(user.fullName) : "—"}
                </span>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{user?.fullName ?? "Signed in"}</span>
              </span>
              <button
                type="button"
                onClick={() => setOv({ ...NO_OVERLAYS, leave: true })}
                style={{
                  height: 34,
                  padding: "0 13px",
                  border: "1.5px solid var(--color-border)",
                  borderRadius: 999,
                  background: "var(--color-card)",
                  color: "var(--color-ink-subtle)",
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Exit
              </button>
            </div>
          </div>

          {/* body: question column | permanently docked palette rail */}
          <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "1fr 288px" }}>
            <div ref={scrollRef} style={{ overflowY: "auto", padding: "18px 24px 24px" }}>
              <div style={{ maxWidth: 680, margin: "0 auto" }}>
                {/* progress = answered count, not position */}
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div
                    style={{ flex: 1, height: 8, background: "var(--color-border)", borderRadius: 4, overflow: "hidden" }}
                    role="progressbar"
                    aria-label="Answered"
                    aria-valuenow={paletteAnswered}
                    aria-valuemin={0}
                    aria-valuemax={total}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${total > 0 ? Math.round((paletteAnswered / total) * 100) : 0}%`,
                        background: "var(--color-primary)",
                        borderRadius: 4,
                      }}
                    />
                  </div>
                  <span className="rl-num" style={{ fontSize: 12, fontWeight: 700, color: SUB, flexShrink: 0 }}>
                    {paletteAnswered} of {total} answered
                  </span>
                </div>

                {/* reassurance strip — device-noun swap for lab machines */}
                <div
                  style={{
                    background: "var(--color-on-device-bg)",
                    borderRadius: 12,
                    padding: "11px 15px",
                    display: "flex",
                    gap: 11,
                    marginTop: 14,
                  }}
                >
                  <span style={{ color: "var(--color-on-device-fg)", flexShrink: 0, display: "inline-flex" }}>
                    <Icon name="phone-check" size={18} />
                  </span>
                  <div style={{ fontSize: 13, lineHeight: 1.45, color: "var(--color-warning-ink)" }}>
                    <b style={{ color: "var(--color-warning-ink-strong)" }}>
                      Your answers save on this computer as you go.
                    </b>{" "}
                    If it restarts, you continue right where you stopped.
                  </div>
                </div>

                {batteryLow ? (
                  <div
                    style={{
                      background: "var(--color-on-device-bg)",
                      border: "1.5px solid var(--color-warning-border)",
                      borderRadius: 12,
                      padding: "10px 13px",
                      display: "flex",
                      gap: 10,
                      marginTop: 10,
                    }}
                  >
                    <span style={{ color: "var(--color-on-device-fg)", flexShrink: 0, display: "inline-flex" }}>
                      <BatteryLowIcon size={17} />
                    </span>
                    <div style={{ fontSize: 12.5, lineHeight: 1.4, color: "var(--color-on-device-fg)" }}>
                      <b>Battery low.</b> Your answers save with every tap — nothing is lost.
                    </div>
                  </div>
                ) : null}

                <div style={{ marginTop: 20 }}>{questionBlock}</div>
                <div aria-live="polite" style={{ marginTop: 14 }}>
                  {answeredHere ? (
                    <Chip
                      tone="synced"
                      icon={<Icon name="check" size={14} />}
                      style={{ padding: "6px 12px", fontSize: 12.5 }}
                    >
                      Saved on this device · just now
                    </Chip>
                  ) : null}
                </div>

                {/* bottom nav: Prev · Flag (F) · Next (→/Enter), all ≥48px */}
                <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
                  <button
                    type="button"
                    aria-label="Previous question"
                    aria-disabled={cur === 0}
                    onClick={() => {
                      if (cur > 0 && selectedId) void engine.setCurrentIndex(selectedId, cur - 1);
                    }}
                    style={{
                      height: 48,
                      padding: "0 20px",
                      border: "1.5px solid var(--color-border)",
                      background: "var(--color-card)",
                      borderRadius: 999,
                      fontSize: 14,
                      fontWeight: 700,
                      color: "var(--color-ink-secondary)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 7,
                      cursor: cur === 0 ? "default" : "pointer",
                      opacity: cur === 0 ? 0.45 : 1,
                      fontFamily: "inherit",
                    }}
                  >
                    <ChevronLeft size={16} />
                    Previous
                  </button>
                  <button
                    type="button"
                    aria-label="Flag for review"
                    aria-pressed={flagged}
                    onClick={() => toggleFlag(q.id)}
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: "50%",
                      background: flagged ? "var(--color-on-device-bg)" : "var(--color-card)",
                      border: flagged
                        ? "2px solid var(--color-on-device-solid)"
                        : "1.5px solid var(--color-border)",
                      color: flagged ? "var(--color-on-device-fg)" : "var(--color-ink)",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      flexShrink: 0,
                      padding: 0,
                    }}
                  >
                    <Icon name="flag" size={18} />
                  </button>
                  <button
                    type="button"
                    className="rl-btn rl-btn--primary"
                    style={{ flex: 1, height: 48, fontSize: 16, fontWeight: 800, gap: 9 }}
                    onClick={() => {
                      if (cur === total - 1) go("review");
                      else if (selectedId) void engine.setCurrentIndex(selectedId, cur + 1);
                    }}
                  >
                    {cur === total - 1 ? "Review" : "Next"}
                    <ArrowRight size={15} />
                  </button>
                </div>
              </div>
            </div>

            {/* palette rail — permanent at desktop (the mobile sheet, docked) */}
            <div
              data-palette-rail
              style={{
                background: "var(--color-card)",
                borderLeft: "1px solid var(--color-border)",
                padding: "18px 16px",
                display: "flex",
                flexDirection: "column",
                overflowY: "auto",
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline" }}>
                <div style={{ flex: 1, fontSize: 13, fontWeight: 800 }}>Questions</div>
                <div className="rl-num" style={{ fontSize: 11.5, fontWeight: 600, color: SUB }}>
                  {paletteAnswered} of {total}
                </div>
              </div>
              <div style={{ marginTop: 13 }}>
                <PaletteGrid
                  answers={paletteAnswers}
                  flags={paletteFlags}
                  cur={cur}
                  showCurrent
                  cols={4}
                  cellH={48}
                  onPick={jumpTo}
                />
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 12, fontSize: 10.5, color: SUB }}>
                <span>filled answered</span>
                <span>flag review</span>
                <span>ring current</span>
              </div>
              <div style={{ marginTop: "auto", paddingTop: 16 }}>
                <Button
                  variant="secondary"
                  style={{ width: "100%", height: 48, fontSize: 14, fontWeight: 800 }}
                  onClick={() => go("review")}
                >
                  Review &amp; submit
                </Button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    const rail = (
      <div
        data-palette-rail
        style={{
          ...card,
          padding: 13,
          display: "flex",
          flexDirection: "column",
          alignSelf: "start",
          position: "sticky",
          top: 6,
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", color: SUB }}>
          QUESTIONS · <span className="rl-num">{paletteAnswered}/{total}</span>
        </div>
        <div style={{ marginTop: 10 }}>
          <PaletteGrid
            answers={paletteAnswers}
            flags={paletteFlags}
            cur={cur}
            showCurrent
            cols={4}
            cellH={42}
            onPick={jumpTo}
          />
        </div>
        <Button
          variant="secondary"
          size="card"
          style={{ marginTop: 12, fontSize: 13, fontWeight: 800 }}
          onClick={() => go("review")}
        >
          Review &amp; submit
        </Button>
      </div>
    );

    return (
      <div
        style={{
          height: "100dvh",
          maxWidth: wide ? 780 : 480,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px 4px" }}>
          <BackCircle label="Leave exam" onClick={() => setOv({ ...NO_OVERLAYS, leave: true })} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{splitTitle(pkg.title).over} Exam</div>
            <div style={{ fontSize: 12.5, color: SUB, marginTop: 1 }}>
              Question {cur + 1} of {total}
            </div>
          </div>
          <TimerPill value={fmtClock(remaining)} phase={phase} label={tLabel} />
        </div>

        {/* progress = answers given, not position */}
        <div style={{ padding: "8px 16px 10px" }}>
          <div
            style={{ height: 8, background: "var(--color-border)", borderRadius: 4, overflow: "hidden" }}
            role="progressbar"
            aria-label="Answered"
            aria-valuenow={paletteAnswered}
            aria-valuemin={0}
            aria-valuemax={total}
          >
            <div
              style={{
                height: "100%",
                width: `${total > 0 ? Math.round((paletteAnswered / total) * 100) : 0}%`,
                background: "var(--color-primary)",
                borderRadius: 4,
              }}
            />
          </div>
        </div>

        {/* reassurance banner — always present while taking */}
        <div
          style={{
            margin: "0 16px 10px",
            background: "var(--color-on-device-bg)",
            borderRadius: 14,
            padding: "10px 13px",
            display: "flex",
            gap: 10,
          }}
        >
          <span style={{ color: "var(--color-on-device-fg)", flexShrink: 0, display: "inline-flex" }}>
            <Icon name="phone-check" size={17} />
          </span>
          <div style={{ fontSize: 12.5, lineHeight: 1.4, color: "var(--color-on-device-fg)" }}>
            <b>Your answers save on this phone as you go.</b> No internet needed.
          </div>
        </div>

        {/* battery-low banner — additive */}
        {batteryLow ? (
          <div
            style={{
              margin: "0 16px 10px",
              background: "var(--color-on-device-bg)",
              border: "1.5px solid var(--color-warning-border)",
              borderRadius: 14,
              padding: "10px 13px",
              display: "flex",
              gap: 10,
            }}
          >
            <span style={{ color: "var(--color-on-device-fg)", flexShrink: 0, display: "inline-flex" }}>
              <BatteryLowIcon size={17} />
            </span>
            <div style={{ fontSize: 12.5, lineHeight: 1.4, color: "var(--color-on-device-fg)" }}>
              <b>Battery low.</b> Your answers save with every tap — even if the phone dies, nothing
              is lost.
            </div>
          </div>
        ) : null}

        {/* question area — the only scrolling region */}
        {wide ? (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "grid",
              gridTemplateColumns: "1fr 232px",
              gap: 14,
              padding: "0 16px",
            }}
          >
            <div ref={scrollRef} style={{ overflowY: "auto", padding: "6px 0 12px" }}>
              <div style={{ maxWidth: 460 }}>
                {questionBlock}
                {savedChip}
              </div>
            </div>
            <div style={{ overflowY: "auto", padding: "6px 0 12px" }}>{rail}</div>
          </div>
        ) : (
          <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "6px 16px 12px" }}>
            {questionBlock}
            {savedChip}
          </div>
        )}

        {/* sticky footer */}
        <div
          style={{
            background: "var(--color-card)",
            boxShadow: "0 -1px 0 var(--color-border)",
            padding: "12px 16px 14px",
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <button
            type="button"
            aria-label="Previous question"
            aria-disabled={cur === 0}
            onClick={() => {
              if (cur > 0 && selectedId) void engine.setCurrentIndex(selectedId, cur - 1);
            }}
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              border: "1.5px solid var(--color-border)",
              background: "var(--color-card)",
              color: "var(--color-ink)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: cur === 0 ? "default" : "pointer",
              opacity: cur === 0 ? 0.35 : 1,
              flexShrink: 0,
              padding: 0,
            }}
          >
            <ChevronLeft size={19} />
          </button>
          <button
            type="button"
            aria-label="Flag for review"
            aria-pressed={flagged}
            onClick={() => toggleFlag(q.id)}
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              background: flagged ? "var(--color-on-device-bg)" : "var(--color-card)",
              border: flagged
                ? "2px solid var(--color-on-device-solid)"
                : "1.5px solid var(--color-border)",
              color: flagged ? "var(--color-on-device-fg)" : "var(--color-ink)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              flexShrink: 0,
              padding: 0,
            }}
          >
            <Icon name="flag" size={18} />
          </button>
          {!wide ? (
            <button
              type="button"
              aria-label="Question palette"
              aria-haspopup="dialog"
              onClick={() => setOv({ ...NO_OVERLAYS, palette: true })}
              style={{
                width: 56,
                height: 48,
                borderRadius: 999,
                border: "1.5px solid var(--color-border)",
                background: "var(--color-card)",
                color: "var(--color-ink)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 1,
                cursor: "pointer",
                flexShrink: 0,
                fontFamily: "inherit",
                padding: 0,
              }}
            >
              <Icon name="navigator" size={15} />
              <span className="rl-num" style={{ fontSize: 9.5, fontWeight: 700 }}>
                {paletteAnswered}/{total}
              </span>
            </button>
          ) : null}
          <button
            type="button"
            className="rl-btn rl-btn--primary"
            style={{ flex: 1, height: 52, fontSize: 16, fontWeight: 800, gap: 9 }}
            onClick={() => {
              if (cur === total - 1) go("review");
              else if (selectedId) void engine.setCurrentIndex(selectedId, cur + 1);
            }}
          >
            {cur === total - 1 ? "Review" : "Next"}
            <span
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                background: "rgba(255,255,255,0.18)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ArrowRight size={14} />
            </span>
          </button>
        </div>
      </div>
    );
  };

  /* ================= screen: review ================= */

  const renderReview = () => {
    const flaggedCount = paletteFlags.filter(Boolean).length;
    const blank = total - paletteAnswered;
    return frame(
      <>
        {chromeBar("Review answers", () => go("taking"))}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 16px 20px" }}>
          <div style={{ ...card, display: "flex", alignItems: "center", gap: 16 }}>
            <StatCol value={paletteAnswered} suffix={`/${total}`} caption="answered" />
            <StatCol value={flaggedCount} caption="flagged" color="var(--color-on-device-fg)" />
            <StatCol
              value={blank}
              caption="blank"
              color={blank > 0 ? "var(--color-on-device-fg)" : "var(--color-ink)"}
            />
            <div style={{ marginLeft: "auto", textAlign: "right" }}>
              <div
                className="rl-num"
                style={{
                  fontSize: 19,
                  fontWeight: 800,
                  color: remaining < 300 ? "var(--color-on-device-fg)" : "var(--color-ink)",
                }}
              >
                {fmtClock(remaining)}
              </div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: SUB }}>left</div>
            </div>
          </div>

          <div style={card}>
            <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 11 }}>
              Tap a number to revisit
            </div>
            <PaletteGrid answers={paletteAnswers} flags={paletteFlags} cur={cur} onPick={jumpTo} />
            <div style={{ display: "flex", gap: 12, marginTop: 11, fontSize: 10.5, color: SUB }}>
              <span>filled = answered</span>
              <span>flag = review</span>
              <span>outline = blank</span>
            </div>
          </div>

          <div
            style={{
              background: "var(--color-on-device-bg)",
              borderRadius: 14,
              padding: "12px 14px",
              display: "flex",
              gap: 10,
            }}
          >
            <span style={{ color: "var(--color-on-device-fg)", flexShrink: 0, display: "inline-flex" }}>
              <Icon name="phone-check" size={16} />
            </span>
            <div style={{ fontSize: 12.5, lineHeight: 1.45, color: "var(--color-on-device-fg)" }}>
              All {paletteAnswered} answers are already safe on this phone. Submitting locks them in.
            </div>
          </div>

          <Button
            size="exam"
            style={{ width: "100%", fontSize: 16, fontWeight: 800 }}
            onClick={() => setOv({ ...NO_OVERLAYS, submitConfirm: true })}
          >
            Submit exam
          </Button>
          <Button
            variant="quiet"
            style={{ width: "100%", height: 48, fontSize: 14, fontWeight: 700 }}
            onClick={() => go("taking")}
          >
            Keep working
          </Button>
        </div>
      </>,
    );
  };

  /* ================= screen: submitted ================= */

  const renderSubmitted = () => {
    let sendCard: ReactNode;
    if (attemptAllSent) {
      sendCard = (
        <div style={card}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 14,
              fontWeight: 800,
              color: "var(--color-synced-fg)",
            }}
          >
            <Icon name="cloud-check" size={17} />
            All {answeredCount} answers are at your school
          </div>
          <div style={{ fontSize: 12.5, color: SUB, marginTop: 5 }}>
            Your teacher will grade them. You&rsquo;re done here.
          </div>
        </div>
      );
    } else if (!offline) {
      sendCard = (
        <div style={card}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              fontWeight: 700,
              color: "var(--color-sending-fg)",
            }}
          >
            <Icon name="send" size={15} />
            <span style={{ flex: 1 }}>Sending to school</span>
            <span className="rl-num">
              {sentCount} of {answeredCount}
            </span>
          </div>
          <div
            style={{
              height: 8,
              background: "var(--color-sending-bg)",
              borderRadius: 4,
              overflow: "hidden",
              marginTop: 9,
            }}
            role="progressbar"
            aria-valuenow={sentCount}
            aria-valuemin={0}
            aria-valuemax={answeredCount}
          >
            <div
              style={{
                height: "100%",
                width: `${answeredCount > 0 ? (sentCount / answeredCount) * 100 : 100}%`,
                background: "var(--color-primary)",
                borderRadius: 4,
              }}
            />
          </div>
          {!ios ? (
            <div style={{ fontSize: 12.5, color: SUB, lineHeight: 1.5, marginTop: 9 }}>
              You can close this app — sending continues in the background.
            </div>
          ) : null}
        </div>
      );
    } else {
      sendCard = (
        <div style={card}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 14,
              fontWeight: 800,
              color: "var(--color-on-device-fg)",
            }}
          >
            <Icon name="phone-check" size={15} />
            {answersPending} answers safe on this phone
          </div>
          <div style={{ fontSize: 12.5, color: SUB, lineHeight: 1.5, marginTop: 5 }}>
            No signal right now — they&rsquo;ll send automatically the moment you&rsquo;re
            connected. You can close the app.
          </div>
        </div>
      );
    }

    return frame(
      <div
        style={{
          flex: 1,
          padding: "14px 16px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 13,
        }}
      >
        <div style={{ textAlign: "center", padding: "14px 0 2px" }}>
          <div
            style={{
              width: 78,
              height: 78,
              borderRadius: "50%",
              background: "var(--color-synced-bg)",
              color: "var(--color-synced-solid)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto",
            }}
          >
            <Icon name="check" size={38} />
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, marginTop: 12 }}>Exam submitted</div>
          <div style={{ fontSize: 13.5, color: SUB, marginTop: 4 }}>
            Saved on this phone at {att?.submitTime || "—"} — it cannot be lost.
          </div>
        </div>

        {sendCard}

        {ios && !attemptAllSent ? (
          <div
            style={{
              background: "var(--color-on-device-bg)",
              border: "1.5px solid var(--color-warning-border)",
              borderRadius: 14,
              padding: "13px 14px",
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
            }}
          >
            <span style={{ color: "var(--color-on-device-fg)", display: "inline-flex", marginTop: 1 }}>
              <Icon name="phone-plain" size={17} />
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-on-device-fg)", lineHeight: 1.45 }}>
                Keep the app open until sending finishes.
              </div>
              <div style={{ fontSize: 12, color: SUB, lineHeight: 1.5, marginTop: 3 }}>
                iPhones pause sending when the app closes. Your answers stay safe either way.
              </div>
              {att?.remindSet ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 12,
                    fontWeight: 700,
                    color: "var(--color-synced-fg)",
                    marginTop: 9,
                  }}
                >
                  <Icon name="check" size={13} />
                  We&rsquo;ll notify you if sending pauses
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (selectedId) void engine.setRemindSet(selectedId);
                  }}
                  style={{
                    height: 36,
                    padding: "0 14px",
                    borderRadius: 999,
                    background: "var(--color-primary-tint)",
                    color: "var(--color-sending-fg)",
                    fontSize: 12,
                    fontWeight: 700,
                    border: "none",
                    cursor: "pointer",
                    marginTop: 9,
                    fontFamily: "inherit",
                  }}
                >
                  {copy.exam.iosRemind}
                </button>
              )}
            </div>
          </div>
        ) : null}

        <Button
          style={{ width: "100%", height: 52, fontSize: 15, fontWeight: 800 }}
          onClick={() => go("status")}
        >
          See exam status
        </Button>
        <Button
          variant="quiet"
          style={{ width: "100%", height: 44, fontSize: 14, fontWeight: 700 }}
          onClick={() => go("list")}
        >
          Back to exams
        </Button>
      </div>,
    );
  };

  /* ================= screen: status ================= */

  const renderStatus = () => {
    const title = pkg?.title ?? item?.title ?? "Exam";
    const graded = Boolean(gradedScore);
    const allSent = att ? attemptAllSent : true; // no local attempt ⇒ nothing waits here
    const totalToSend = att ? answeredCount : (selStatus?.answersReceived ?? 0);
    const sent = att ? sentCount : totalToSend;
    const submitTime = att?.submitTime || "—";

    const step2: StepKind = allSent ? "done" : !offline ? "active" : "waiting";
    const step2Desc =
      step2 === "done"
        ? `All ${totalToSend} answers received`
        : step2 === "active"
          ? `${sent} of ${totalToSend} sent — continues in background`
          : `Waiting for signal · ${sent} of ${totalToSend} sent`;
    const step3: StepKind = graded ? "done" : "pending";
    const step3Desc = graded
      ? "Checked · result below"
      : allSent
        ? "Your school is checking — usually within a day"
        : "Starts after your school receives all answers";

    return frame(
      <>
        {chromeBar("Exam status", () => go("list"))}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 16px 20px" }}>
          <div style={{ ...card, padding: "14px 15px" }}>
            <div style={{ fontSize: 15.5, fontWeight: 700 }}>{title}</div>
            <div style={{ fontSize: 12.5, color: SUB, marginTop: 3 }}>
              Submitted today at {submitTime}
            </div>
          </div>

          {/* attention banner — the ONLY red state, and only when action helps */}
          {!allSent && offline ? (
            <div
              style={{
                background: "var(--color-attention-bg)",
                border: "1.5px solid var(--color-danger-border)",
                borderRadius: 14,
                padding: "12px 14px",
                display: "flex",
                gap: 10,
              }}
            >
              <span style={{ color: "var(--color-attention-fg)", flexShrink: 0, display: "inline-flex" }}>
                <Icon name="attention" size={17} />
              </span>
              <div
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  lineHeight: 1.45,
                  color: "var(--color-attention-fg)",
                }}
              >
                {copy.exam.escalation.en}
              </div>
            </div>
          ) : null}

          <div style={card}>
            <TimelineStep
              kind="done"
              title="Saved on this phone"
              desc={`${submitTime} · all ${totalToSend} answers`}
            />
            <TimelineStep kind={step2} title="Sent to school" desc={step2Desc} />
            <TimelineStep kind={step3} title="Checked & graded" desc={step3Desc} last />
          </div>

          {graded ? (
            <div
              style={{
                background: "var(--color-synced-bg)",
                border: "1.5px solid var(--color-success-border)",
                borderRadius: 14,
                padding: 15,
                textAlign: "center",
              }}
            >
              <div className="rl-num" style={{ fontSize: 24, fontWeight: 800, color: "var(--color-synced-fg)" }}>
                {(gradedScore ?? "").replace("/", " / ")}
              </div>
              <div
                style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-synced-fg)", marginTop: 3 }}
              >
                Checked by your school · Great work, {shortName}!
              </div>
            </div>
          ) : null}
        </div>
      </>,
    );
  };

  /* ================= screen: recovery ================= */

  const renderRecovery = () => (
    <div
      style={{
        minHeight: "100dvh",
        maxWidth: 480,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 84,
          height: 84,
          borderRadius: "50%",
          background: "var(--color-on-device-bg)",
          color: "var(--color-on-device-solid)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name="phone-check" size={40} />
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, marginTop: 16 }}>
        Welcome back, {shortName}
      </div>
      <div style={{ fontSize: 15, color: SUB, lineHeight: 1.55, maxWidth: 280, marginTop: 8 }}>
        Your <b style={{ color: "var(--color-ink)" }}>{answeredCount} answers are safe</b> on this phone.
        Everything saved as you worked.
      </div>
      <div style={{ display: "flex", gap: 14, fontSize: 12.5, fontWeight: 600, color: SUB, marginTop: 14 }}>
        <span>Paused at question {cur + 1}</span>
        <span aria-hidden>·</span>
        <span className="rl-num">{fmtClock(remaining)} left</span>
      </div>
      <Button
        size="exam"
        style={{ padding: "0 34px", fontSize: 16, fontWeight: 800, marginTop: 22 }}
        onClick={() => go("taking")}
      >
        Continue exam
      </Button>
    </div>
  );

  /* ================= compose ================= */

  if (!eng.ready || stage === null) return null;

  let screen: ReactNode = null;
  switch (stage) {
    case "list":
      screen = renderList();
      break;
    case "detail":
      screen = renderDetail();
      break;
    case "taking":
      screen = renderTaking();
      break;
    case "review":
      screen = renderReview();
      break;
    case "submitted":
      screen = renderSubmitted();
      break;
    case "status":
      screen = renderStatus();
      break;
    case "recovery":
      screen = renderRecovery();
      break;
  }

  return (
    <>
      {screen}

      {/* palette bottom sheet (phones; the rail replaces it at ≥720dp) */}
      {ov.palette && !wide && stage === "taking" ? (
        <>
          <div className="scrim" onClick={closeOv} />
          <div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Questions"
            style={{ borderRadius: "20px 20px 0 0", padding: "16px 16px 20px" }}
          >
            <div className="sheet__grabber" style={{ width: 44, height: 5, borderRadius: 3, marginBottom: 13 }} />
            <div style={{ display: "flex", alignItems: "baseline" }}>
              <div style={{ flex: 1, fontSize: 16, fontWeight: 800 }}>Questions</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: SUB }}>
                {paletteAnswered} of {total} answered
              </div>
            </div>
            <div style={{ marginTop: 13 }}>
              <PaletteGrid answers={paletteAnswers} flags={paletteFlags} cur={cur} showCurrent onPick={jumpTo} />
            </div>
            <Button
              variant="secondary"
              style={{ width: "100%", height: 50, marginTop: 15, fontSize: 15, fontWeight: 800 }}
              onClick={() => go("review")}
            >
              Review &amp; submit
            </Button>
          </div>
        </>
      ) : null}

      {/* Sync Center sheet (phones; the anchored popover lives in chromeBar) */}
      {ov.sync && !wide ? (
        <>
          <div className="scrim" onClick={closeOv} />
          <div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Sync Center"
            style={{ borderRadius: "20px 20px 0 0", padding: "16px 16px 18px" }}
          >
            <div className="sheet__grabber" style={{ width: 44, height: 5, borderRadius: 3, marginBottom: 13 }} />
            <SyncCenterContent eng={eng} onSendNow={() => void sendNow()} />
          </div>
        </>
      ) : null}

      {/* dialogs */}
      {ov.dlConfirm && selectedId ? (
        <DialogShell
          title="Download this exam?"
          body={`${fmtSize(item?.packageBytes ?? 0)} — uses your mobile data once. After that the exam works with no signal.`}
          primaryLabel={`Download · ${fmtSize(item?.packageBytes ?? 0)}`}
          onPrimary={() => {
            setOv(NO_OVERLAYS);
            void engine.downloadExam(selectedId).catch(() => {
              showToast(NO_CONNECTION_MESSAGE);
            });
          }}
          secondaryLabel="Not now"
          onSecondary={closeOv}
          onDismiss={closeOv}
        />
      ) : null}

      {ov.submitConfirm ? (
        <DialogShell
          title={`Submit ${paletteAnswered} answers?`}
          body="Once submitted, answers can't be changed. Everything is already saved on this phone."
          extra={
            total - paletteAnswered > 0 ? (
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-on-device-fg)", marginTop: 8 }}>
                {total - paletteAnswered} items are still blank.
              </div>
            ) : null
          }
          primaryLabel="Submit exam"
          onPrimary={() => void doSubmitNow()}
          secondaryLabel="Keep working"
          onSecondary={closeOv}
          onDismiss={closeOv}
        />
      ) : null}

      {ov.leave ? (
        <DialogShell
          title={lab ? "Exit the exam?" : "Leave the exam?"}
          body={
            lab
              ? `Your answers stay saved on this device, but the timer keeps running. You'll come back to question ${cur + 1}.`
              : "Your answers stay saved on this phone, but the timer keeps running."
          }
          primaryLabel="Stay in exam"
          onPrimary={closeOv}
          secondaryLabel={lab ? "Exit" : "Leave anyway"}
          onSecondary={() => go("detail")}
          onDismiss={closeOv}
        />
      ) : null}

      {/* toast — colors fixed in BOTH themes */}
      {toast ? (
        <div
          style={{
            position: "fixed",
            top: 14,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
            zIndex: 80,
            pointerEvents: "none",
          }}
        >
          <Toast style={{ background: "#17233F", color: "#fff", boxShadow: "0 4px 14px rgba(12,19,34,0.3)" }}>
            {toast}
          </Toast>
        </div>
      ) : null}

      {/* timer milestone announcements (10:00 / 5:00 / 1:00) */}
      <div aria-live="polite" style={srOnly}>
        {announce}
      </div>
    </>
  );
}
