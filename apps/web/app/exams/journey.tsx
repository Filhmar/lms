"use client";

/**
 * Exam journey — one interactive client experience implementing the
 * prototype's stage machine (list → detail → taking → review → submitted →
 * status → recovery) with overlays (palette sheet/rail, Sync Center
 * sheet/popover, download/submit/leave dialogs) and the confirm toast.
 *
 * No network calls: localStorage stands in for the IndexedDB repository +
 * outbox; the demo harness (⚙) drives connectivity / theme / iOS / battery.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Button,
  Chip,
  Icon,
  SyncPill,
  TimerPill,
  Toast,
  type TimerPhase,
  type WorkState,
} from "@rl/ui";
import * as copy from "@/lib/copy";
import { exam as examFx, examQuestions, otherExams, student } from "@/lib/fixtures";
import { useDemo } from "@/lib/demo";
import { AppShell } from "@/components/app-chrome";
import { SyncCenterContent } from "./sync-center";
import {
  advanceTick,
  answeredCount,
  DURATION,
  fmtClock,
  freshState,
  inProgress,
  loadState,
  nowTime,
  pendingAll,
  pendingExam,
  serialize,
  STORAGE_KEY,
  strings,
  TOTAL,
  EXTRAS_TOTAL,
  type Answer,
  type ExamSnapshot,
  type Stage,
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

export function ExamJourney() {
  const { connectivity, theme, iosMode, batteryLow } = useDemo();
  const wide = useWide();

  const [s, setS] = useState<ExamSnapshot>(freshState);
  const [hydrated, setHydrated] = useState(false);
  const [ov, setOv] = useState<Overlays>(NO_OVERLAYS);
  const [toast, setToast] = useState("");
  const [announce, setAnnounce] = useState("");

  const sRef = useRef(s);
  useEffect(() => {
    sRef.current = s;
  }, [s]);

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

  /* ----- restore on mount; stored stage 'taking' → recovery ----- */
  useEffect(() => {
    setS(loadState());
    setHydrated(true);
  }, []);

  /* ----- persist on every mutation (deduped) ----- */
  const lastSnap = useRef("");
  useEffect(() => {
    if (!hydrated) return;
    const snap = serialize(s);
    if (snap === lastSnap.current) return;
    lastSnap.current = snap;
    try {
      localStorage.setItem(STORAGE_KEY, snap);
    } catch {
      /* storage unavailable */
    }
  }, [hydrated, s]);

  /* ----- submit ----- */
  const doSubmitNow = useCallback(
    (auto: boolean) => {
      setOv(NO_OVERLAYS);
      setS((p) => ({
        ...p,
        submitted: true,
        submitTime: nowTime(),
        stage: "submitted",
        timer: auto ? 0 : p.timer,
      }));
      if (auto) showToast(strings.toastTimesUp);
    },
    [showToast],
  );

  /* ----- countdown: 1000ms, only while taking & not submitted ----- */
  useEffect(() => {
    if (!hydrated || s.stage !== "taking" || s.submitted) return;
    const id = setInterval(() => {
      const cur = sRef.current;
      if (cur.timer <= 1) {
        doSubmitNow(true);
        return;
      }
      const t = cur.timer - 1;
      // Screen-reader milestones at 10:00 / 5:00 / 1:00 only.
      if (t === 600 || t === 300 || t === 60) setAnnounce(`${t / 60} min left`);
      setS((p) => ({ ...p, timer: Math.max(0, p.timer - 1) }));
    }, 1000);
    return () => clearInterval(id);
  }, [hydrated, s.stage, s.submitted, doSubmitNow]);

  /* ----- 350ms process tick: download / drip / extras / grading ----- */
  const tickRef = useRef(0);
  useEffect(() => {
    if (!hydrated) return;
    const id = setInterval(() => {
      tickRef.current += 1;
      const tick = tickRef.current;
      setS((p) => advanceTick(p, connectivity, tick));
    }, 350);
    return () => clearInterval(id);
  }, [hydrated, connectivity]);

  /* ----- Esc closes any overlay ----- */
  const anyOverlay = ov.palette || ov.sync || ov.submitConfirm || ov.leave || ov.dlConfirm;
  useEffect(() => {
    if (!anyOverlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOv(NO_OVERLAYS);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [anyOverlay]);

  /* ----- question focus + scroll reset on navigation ----- */
  const stemRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!hydrated || s.stage !== "taking") return;
    scrollRef.current?.scrollTo({ top: 0 });
    stemRef.current?.focus();
  }, [hydrated, s.stage, s.cur]);

  /* ----- actions ----- */
  const closeOv = useCallback(() => setOv(NO_OVERLAYS), []);
  const go = useCallback((stage: Stage) => {
    setOv(NO_OVERLAYS);
    setS((p) => ({ ...p, stage }));
  }, []);
  const setAnswer = (i: number, v: Answer) =>
    setS((p) => ({ ...p, answers: p.answers.map((a, j) => (j === i ? v : a)) }));
  const pickOption = (i: number, opt: number) => {
    setAnswer(i, opt);
    showToast(strings.toastSaved);
  };
  const toggleFlag = (i: number) => {
    const on = !(sRef.current.flags[i] ?? false);
    setS((p) => ({ ...p, flags: p.flags.map((f, j) => (j === i ? on : f)) }));
    showToast(on ? strings.toastFlagged : strings.toastUnflagged);
  };
  const jumpTo = (i: number) => {
    setOv(NO_OVERLAYS);
    setS((p) => ({ ...p, cur: i, stage: "taking" }));
  };
  const startExam = () => {
    setOv(NO_OVERLAYS);
    setS((p) => ({
      ...p,
      answers: Array<Answer>(TOTAL).fill(null),
      flags: Array<boolean>(TOTAL).fill(false),
      cur: 0,
      timer: DURATION,
      submitted: false,
      submitTime: "",
      sent: 0,
      graded: false,
      gradeTicks: 0,
      stage: "taking",
    }));
  };
  const sendNow = () => {
    if (connectivity === "offline") return;
    setS((p) => ({
      ...p,
      sent: p.submitted ? TOTAL : p.sent,
      extraSent: EXTRAS_TOTAL,
      lastSync: "just now",
    }));
    setOv(NO_OVERLAYS);
    showToast(strings.toastAllSent);
  };

  /* ----- derived ----- */
  const answered = answeredCount(s.answers);
  const flaggedCount = s.flags.filter(Boolean).length;
  const blank = TOTAL - answered;
  const pendEx = pendingExam(s);
  const pendAll = pendingAll(s);
  const offline = connectivity === "offline";
  const inProg = inProgress(s);

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
      <SyncPill
        as="button"
        chrome
        state={pillState}
        label={pillLabel}
        offline={offline}
        aria-haspopup="dialog"
        onClick={() => setOv({ ...NO_OVERLAYS, sync: true })}
        style={{ cursor: "pointer", border: "none", fontFamily: "inherit" }}
      />
    </div>
  );

  const frame = (children: ReactNode) => (
    <div
      style={{
        minHeight: "100dvh",
        maxWidth: 480,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {children}
    </div>
  );

  /* ================= screen: exam list ================= */

  const renderList = () => {
    let todayChip: ReactNode = null;
    if (!s.submitted && s.dlState === "none") {
      todayChip = (
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
          Download to take offline · {examFx.downloadSize}
        </span>
      );
    } else if (!s.submitted && s.dlState === "ready") {
      todayChip = (
        <Chip tone="synced" size="compact" icon={<Icon name="phone-check" size={12} />}>
          Ready on this phone — works with no signal
        </Chip>
      );
    } else if (s.submitted && (pendEx === 0 || s.graded)) {
      todayChip = (
        <Chip tone="synced" size="compact" icon={<Icon name="cloud-check" size={13} />}>
          {s.graded ? `Graded · ${examFx.gradedScore}` : "At school · awaiting grading"}
        </Chip>
      );
    } else if (s.submitted && pendEx > 0 && !offline) {
      todayChip = (
        <Chip tone="sending" size="compact" icon={<Icon name="send" size={12} />}>
          Sending to school · {s.sent} of {TOTAL}
        </Chip>
      );
    } else if (s.submitted && pendEx > 0) {
      todayChip = (
        <Chip tone="on-device" size="compact" icon={<Icon name="phone-check" size={12} />}>
          Submitted · {pendEx} answers to send
        </Chip>
      );
    }
    // downloading → no chip (progress lives on the Detail screen)

    return (
      <AppShell examBadge={s.submitted ? undefined : 1}>
        {chromeBar("Exams")}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 16px 20px" }}>
          <div className="rl-overline" style={{ marginTop: 6 }}>
            Today
          </div>
          <button
            type="button"
            onClick={() => go(s.submitted ? "status" : "detail")}
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
              <div style={{ flex: 1, fontSize: 15.5, fontWeight: 700 }}>{examFx.title}</div>
              <div style={{ fontSize: 11.5, color: SUB, flex: "none" }}>until 5 PM</div>
            </div>
            <div style={{ fontSize: 12.5, color: SUB, marginTop: 3 }}>
              {examFx.items} items · {examFx.minutes} min · {examFx.attempts}
            </div>
            {todayChip ? <div style={{ marginTop: 10 }}>{todayChip}</div> : null}
          </button>

          <div className="rl-overline" style={{ marginTop: 8 }}>
            Coming up
          </div>
          <div style={{ ...card, padding: "14px 15px", opacity: 0.75 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <div style={{ flex: 1, fontSize: 15.5, fontWeight: 700 }}>{otherExams[0].title}</div>
              <div style={{ fontSize: 11.5, color: SUB, flex: "none" }}>opens Mon</div>
            </div>
            <div style={{ fontSize: 12.5, color: SUB, marginTop: 3 }}>
              Your teacher will release this on July 13. You&rsquo;ll be able to download it early.
            </div>
          </div>

          <div className="rl-overline" style={{ marginTop: 8 }}>
            Finished
          </div>
          <div style={{ ...card, padding: "14px 15px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ flex: 1, fontSize: 15.5, fontWeight: 700 }}>{otherExams[1].title}</div>
              <Chip tone="synced" size="compact" icon={<Icon name="cloud-check" size={13} />}>
                Graded · 38/40
              </Chip>
            </div>
          </div>
        </div>
      </AppShell>
    );
  };

  /* ================= screen: exam detail ================= */

  const renderDetail = () => {
    const dlBorder = theme === "dark" ? "#2C4270" : "#ADC4F5";
    return frame(
      <>
        {chromeBar("Exam details", () => go("list"))}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 16px 20px" }}>
          <div style={card}>
            <div className="rl-overline">{examFx.shortTitle}</div>
            <div style={{ fontSize: 19, fontWeight: 800, marginTop: 4 }}>Periodical Examination</div>
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
                {examFx.minutes} minutes
              </span>
              <span>{examFx.items} items</span>
              <span>{examFx.attempts}</span>
              <span>{examFx.teacher}</span>
            </div>
          </div>

          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 800 }}>Instructions</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.55, color: SUB, marginTop: 6 }}>
              Answer all items. Multiple choice and true/false: pick one answer. Identification:
              spelling matters. The timer starts when you begin and keeps running if you leave.
            </div>
          </div>

          {s.dlState === "none" ? (
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
                Download exam · {examFx.downloadSize}
              </Button>
            </div>
          ) : null}

          {s.dlState === "downloading" ? (
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
                <span className="rl-num">{s.dlPct}%</span>
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
                aria-valuenow={s.dlPct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${s.dlPct}%`,
                    background: "var(--color-primary)",
                    borderRadius: 4,
                  }}
                />
              </div>
              {offline ? (
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

          {s.dlState === "ready" ? (
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
                style={{ width: "100%", fontSize: 16, fontWeight: 800 }}
                onClick={inProg ? () => go("taking") : startExam}
              >
                {inProg ? "Continue exam" : "Start exam"}
              </Button>
            </>
          ) : null}
        </div>
      </>,
    );
  };

  /* ================= screen: taking ================= */

  const renderTaking = () => {
    const q = examQuestions[s.cur];
    if (!q) return null;
    const ans = s.answers[s.cur] ?? null;
    const answeredHere = ans !== null && ans !== "";
    const flagged = s.flags[s.cur] ?? false;
    const phase: TimerPhase = s.timer < 60 ? "critical" : s.timer < 300 ? "warning" : "normal";
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
            {s.cur + 1}. {q.text}
          </label>
          <input
            id="ident-answer"
            className="rl-input"
            value={typeof ans === "string" ? ans : ""}
            onChange={(e) => setAnswer(s.cur, e.target.value === "" ? null : e.target.value)}
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
              {typeof ans === "string" ? ans.length : 0}/40
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
            {s.cur + 1}. {q.text}
          </legend>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
            {(q.options ?? []).map((opt, i) => {
              const selected = ans === i;
              return (
                <label
                  key={opt}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    minHeight: 54,
                    padding: "13px 15px",
                    borderRadius: 14,
                    cursor: "pointer",
                    background: selected ? "var(--color-primary-selected)" : "var(--color-card)",
                    border: selected
                      ? "2px solid var(--color-primary)"
                      : "1.5px solid var(--color-border)",
                    boxShadow:
                      selected && theme !== "dark" ? "0 2px 6px rgba(30,74,194,0.10)" : undefined,
                  }}
                >
                  <input
                    type="radio"
                    name={`q-${s.cur}`}
                    checked={selected}
                    onChange={() => pickOption(s.cur, i)}
                    style={srOnly}
                  />
                  {selected ? (
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
                    {opt}
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

    const rail = (
      <div
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
          QUESTIONS · <span className="rl-num">{answered}/{TOTAL}</span>
        </div>
        <div style={{ marginTop: 10 }}>
          <PaletteGrid
            answers={s.answers}
            flags={s.flags}
            cur={s.cur}
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
            <div style={{ fontSize: 16, fontWeight: 700 }}>{examFx.subject} Exam</div>
            <div style={{ fontSize: 12.5, color: SUB, marginTop: 1 }}>
              Question {s.cur + 1} of {TOTAL}
            </div>
          </div>
          <TimerPill value={fmtClock(s.timer)} phase={phase} label={tLabel} />
        </div>

        {/* progress = answers given, not position */}
        <div style={{ padding: "8px 16px 10px" }}>
          <div
            style={{ height: 8, background: "var(--color-border)", borderRadius: 4, overflow: "hidden" }}
            role="progressbar"
            aria-label="Answered"
            aria-valuenow={answered}
            aria-valuemin={0}
            aria-valuemax={TOTAL}
          >
            <div
              style={{
                height: "100%",
                width: `${Math.round((answered / TOTAL) * 100)}%`,
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
            aria-disabled={s.cur === 0}
            onClick={() => {
              if (s.cur > 0) setS((p) => ({ ...p, cur: p.cur - 1 }));
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
              cursor: s.cur === 0 ? "default" : "pointer",
              opacity: s.cur === 0 ? 0.35 : 1,
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
            onClick={() => toggleFlag(s.cur)}
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
                {answered}/{TOTAL}
              </span>
            </button>
          ) : null}
          <button
            type="button"
            className="rl-btn rl-btn--primary"
            style={{ flex: 1, height: 52, fontSize: 16, fontWeight: 800, gap: 9 }}
            onClick={() => {
              if (s.cur === TOTAL - 1) go("review");
              else setS((p) => ({ ...p, cur: p.cur + 1 }));
            }}
          >
            {s.cur === TOTAL - 1 ? "Review" : "Next"}
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

  const renderReview = () =>
    frame(
      <>
        {chromeBar("Review answers", () => go("taking"))}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 16px 20px" }}>
          <div style={{ ...card, display: "flex", alignItems: "center", gap: 16 }}>
            <StatCol value={answered} suffix={`/${TOTAL}`} caption="answered" />
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
                  color: s.timer < 300 ? "var(--color-on-device-fg)" : "var(--color-ink)",
                }}
              >
                {fmtClock(s.timer)}
              </div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: SUB }}>left</div>
            </div>
          </div>

          <div style={card}>
            <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 11 }}>
              Tap a number to revisit
            </div>
            <PaletteGrid answers={s.answers} flags={s.flags} cur={s.cur} onPick={jumpTo} />
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
              All {answered} answers are already safe on this phone. Submitting locks them in.
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

  /* ================= screen: submitted ================= */

  const renderSubmitted = () => {
    let sendCard: ReactNode;
    if (pendEx === 0) {
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
            All {TOTAL} answers are at your school
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
              {s.sent} of {TOTAL}
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
            aria-valuenow={s.sent}
            aria-valuemin={0}
            aria-valuemax={TOTAL}
          >
            <div
              style={{
                height: "100%",
                width: `${(s.sent / TOTAL) * 100}%`,
                background: "var(--color-primary)",
                borderRadius: 4,
              }}
            />
          </div>
          {!iosMode ? (
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
            {pendEx} answers safe on this phone
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
            Saved on this phone at {s.submitTime} — it cannot be lost.
          </div>
        </div>

        {sendCard}

        {iosMode && pendEx > 0 ? (
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
              {s.remindSet ? (
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
                  onClick={() => setS((p) => ({ ...p, remindSet: true }))}
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
    const step2: StepKind = pendEx === 0 ? "done" : !offline ? "active" : "waiting";
    const step2Desc =
      step2 === "done"
        ? `All ${TOTAL} answers received`
        : step2 === "active"
          ? `${s.sent} of ${TOTAL} sent — continues in background`
          : `Waiting for signal · ${s.sent} of ${TOTAL} sent`;
    const step3: StepKind = s.graded ? "done" : "pending";
    const step3Desc = s.graded
      ? "Checked · result below"
      : pendEx === 0
        ? "Your school is checking — usually within a day"
        : "Starts after your school receives all answers";

    return frame(
      <>
        {chromeBar("Exam status", () => go("list"))}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 16px 20px" }}>
          <div style={{ ...card, padding: "14px 15px" }}>
            <div style={{ fontSize: 15.5, fontWeight: 700 }}>{examFx.title}</div>
            <div style={{ fontSize: 12.5, color: SUB, marginTop: 3 }}>
              Submitted today at {s.submitTime}
            </div>
          </div>

          {/* attention banner — the ONLY red state, and only when action helps */}
          {pendEx > 0 && offline ? (
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
              desc={`${s.submitTime} · all ${TOTAL} answers`}
            />
            <TimelineStep kind={step2} title="Sent to school" desc={step2Desc} />
            <TimelineStep kind={step3} title="Checked & graded" desc={step3Desc} last />
          </div>

          {s.graded ? (
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
                10 / 12
              </div>
              <div
                style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-synced-fg)", marginTop: 3 }}
              >
                Checked by your school · Great work, {student.shortName}!
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
        Welcome back, {student.shortName}
      </div>
      <div style={{ fontSize: 15, color: SUB, lineHeight: 1.55, maxWidth: 280, marginTop: 8 }}>
        Your <b style={{ color: "var(--color-ink)" }}>{answered} answers are safe</b> on this phone.
        Everything saved as you worked.
      </div>
      <div style={{ display: "flex", gap: 14, fontSize: 12.5, fontWeight: 600, color: SUB, marginTop: 14 }}>
        <span>Paused at question {s.cur + 1}</span>
        <span aria-hidden>·</span>
        <span className="rl-num">{fmtClock(s.timer)} left</span>
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

  if (!hydrated) return null;

  let screen: ReactNode = null;
  switch (s.stage) {
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
      {ov.palette && !wide && s.stage === "taking" ? (
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
                {answered} of {TOTAL} answered
              </div>
            </div>
            <div style={{ marginTop: 13 }}>
              <PaletteGrid answers={s.answers} flags={s.flags} cur={s.cur} showCurrent onPick={jumpTo} />
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

      {/* Sync Center: sheet on phones, anchored popover at ≥720dp */}
      {ov.sync ? (
        wide ? (
          <>
            <div className="scrim" style={{ background: "transparent" }} onClick={closeOv} />
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Sync Center"
              style={{
                position: "fixed",
                top: 64,
                left: "50%",
                transform: "translateX(calc(-50% + 70px))",
                width: 360,
                maxWidth: "calc(100vw - 32px)",
                background: "var(--color-card)",
                border: "1px solid var(--color-border)",
                borderRadius: 14,
                boxShadow: "0 10px 30px rgba(12,19,34,0.14)",
                padding: 14,
                zIndex: 51,
              }}
            >
              <SyncCenterContent s={s} connectivity={connectivity} onSendNow={sendNow} />
            </div>
          </>
        ) : (
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
              <SyncCenterContent s={s} connectivity={connectivity} onSendNow={sendNow} />
            </div>
          </>
        )
      ) : null}

      {/* dialogs */}
      {ov.dlConfirm ? (
        <DialogShell
          title="Download this exam?"
          body="1.2 MB — uses your mobile data once. After that the exam works with no signal."
          primaryLabel={`Download · ${examFx.downloadSize}`}
          onPrimary={() => {
            setOv(NO_OVERLAYS);
            setS((p) => ({ ...p, dlState: "downloading", dlPct: 2 }));
          }}
          secondaryLabel="Not now"
          onSecondary={closeOv}
          onDismiss={closeOv}
        />
      ) : null}

      {ov.submitConfirm ? (
        <DialogShell
          title={`Submit ${answered} answers?`}
          body="Once submitted, answers can't be changed. Everything is already saved on this phone."
          extra={
            blank > 0 ? (
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-on-device-fg)", marginTop: 8 }}>
                {blank} items are still blank.
              </div>
            ) : null
          }
          primaryLabel="Submit exam"
          onPrimary={() => doSubmitNow(false)}
          secondaryLabel="Keep working"
          onSecondary={closeOv}
          onDismiss={closeOv}
        />
      ) : null}

      {ov.leave ? (
        <DialogShell
          title="Leave the exam?"
          body="Your answers stay saved on this phone, but the timer keeps running."
          primaryLabel="Stay in exam"
          onPrimary={closeOv}
          secondaryLabel="Leave anyway"
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
