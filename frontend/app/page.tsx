"use client";

/**
 * Student home — "the daily front door, in every condition" (deep-dive d3,
 * key-screens p1c). The HEADER is real: greeting/school/avatar come from the
 * session (/users/me) and the avatar opens a small menu with Log out. The
 * BODY (continue card, exam card, courses, badges) is Phase II–III demo
 * content and stays fixture-driven inside the PreviewShell (badge + ⚙):
 *   · online            → d3a normal day
 *   · offline           → d3c exam-day-offline (pinned exam + the one red banner)
 *   · ?state=hydrating  → d3b first-run hydration (skeletons, never blocking)
 * PWA-shell bits from p3f (install onboarding + update toast) fold in here.
 */

import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bar, Button, Chip, Icon, SkeletonRow, SyncPill } from "@rl/ui";
import { AppHeader, AppShell } from "@/components/app-chrome";
import { PreviewShell } from "@/components/preview";
import * as copy from "@/lib/copy";
import { exam } from "@/lib/fixtures";
import { useDemo, useOnline } from "@/lib/demo";
import { initialsOf, RequireAuth, useSession } from "@/lib/session";

const EYEBROW: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 800,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--color-ink-subtle)",
};

export default function HomePage() {
  return (
    <RequireAuth>
      <PreviewShell>
        <Suspense fallback={null}>
          <HomeScreen />
        </Suspense>
      </PreviewShell>
    </RequireAuth>
  );
}

/** Session avatar — tap for a small menu with Log out. */
function AvatarMenu() {
  const { user, logout } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        className="rl-avatar"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${user.fullName}`}
        onClick={() => setOpen((o) => !o)}
        style={{ fontSize: 14, border: "none", cursor: "pointer", fontFamily: "inherit" }}
      >
        {initialsOf(user.fullName)}
      </button>
      {open ? (
        <div
          role="menu"
          className="rl-card"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 55,
            width: 210,
            padding: 10,
            boxShadow: "0 8px 24px rgba(12,19,34,0.18)",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 800 }}>{user.fullName}</div>
          <div
            style={{
              fontSize: 11,
              color: "var(--color-ink-subtle)",
              marginTop: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {user.email}
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void logout().then(() => router.replace("/login"));
            }}
            style={{
              marginTop: 10,
              width: "100%",
              height: 40,
              border: "1.5px solid var(--color-border)",
              borderRadius: 999,
              background: "var(--color-card)",
              color: "var(--color-ink-secondary)",
              fontSize: 12.5,
              fontWeight: 800,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Log out
          </button>
        </div>
      ) : null}
    </div>
  );
}

function HomeScreen() {
  const params = useSearchParams();
  const hydrating = params.get("state") === "hydrating";
  const online = useOnline();
  const { iosMode } = useDemo();
  const { user } = useSession();

  const shortName = user ? (user.fullName.split(/\s+/)[0] ?? user.fullName) : "";

  /* Greeting rotates by time of day; renders from the session profile. */
  const [greeting, setGreeting] = useState(`Magandang umaga, ${shortName}!`);
  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(
      h < 12
        ? `Magandang umaga, ${shortName}!`
        : h < 18
          ? `Magandang hapon, ${shortName}!`
          : `Magandang gabi, ${shortName}!`,
    );
  }, [shortName]);

  /* Status announcements for the pill (aria-live, never a page reload). */
  const [liveMsg, setLiveMsg] = useState("");
  const firstStatus = useRef(true);
  useEffect(() => {
    if (firstStatus.current) {
      firstStatus.current = false;
      return;
    }
    setLiveMsg(online ? copy.syncCenter.pillAllClear : copy.environment.offline);
  }, [online]);

  /* Filipino 8 "Get · 31 MB" — a separate 48px action on the row. */
  const [filipinoDl, setFilipinoDl] = useState<"idle" | "downloading" | "done">("idle");
  const [filipinoPct, setFilipinoPct] = useState(0);
  useEffect(() => {
    if (filipinoDl !== "downloading" || !online) return;
    const t = setInterval(() => {
      setFilipinoPct((p) => Math.min(100, p + 4));
    }, 350);
    return () => clearInterval(t);
  }, [filipinoDl, online]);
  useEffect(() => {
    if (filipinoPct >= 100 && filipinoDl === "downloading") {
      setFilipinoDl("done");
      setLiveMsg("Filipino 8 is on this phone.");
    }
  }, [filipinoPct, filipinoDl]);

  /* p3f folds: install onboarding banner + "new version ready" toast. */
  const [installDismissed, setInstallDismissed] = useState(false);
  const [updateToast, setUpdateToast] = useState<"hidden" | "shown" | "dismissed">("hidden");
  useEffect(() => {
    if (!online || hydrating) return;
    const t = setTimeout(() => {
      setUpdateToast((s) => (s === "hidden" ? "shown" : s));
    }, 1500);
    return () => clearTimeout(t);
  }, [online, hydrating]);

  const pill = hydrating ? (
    <span className="rl-chip rl-chip--sending rl-chip--chrome">
      <Icon name="download" size={13} />
      <span className="rl-num">Setting up…</span>
    </span>
  ) : (
    <Link href="/sync" aria-label="Open Sync Center" style={{ textDecoration: "none" }}>
      {online ? (
        <SyncPill state="synced" label={copy.syncCenter.pillAllClear} chrome />
      ) : (
        <SyncPill state="on-device" label={copy.syncCenter.pillResting(8)} offline chrome />
      )}
    </Link>
  );

  return (
    <AppShell examBadge={1}>
      <style>{homeCss}</style>
      <span className="home-vh" aria-live="polite">
        {liveMsg}
      </span>

      <AppHeader
        greeting={hydrating ? `Welcome, ${shortName}!` : greeting}
        sub={user?.scopeName ?? ""}
        trailing={pill}
        avatar={<AvatarMenu />}
      />

      {hydrating ? (
        <HydrationBody />
      ) : (
        <div className="page-body">
          {/* d3c — the only escalation allowed on home, offline + action helps */}
          {!online ? (
            <div
              role="alert"
              style={{
                background: "var(--color-attention-bg)",
                border: "1.5px solid var(--color-danger-border)",
                borderRadius: 14,
                padding: "11px 13px",
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
              }}
            >
              <span style={{ color: "var(--color-attention-fg)", display: "inline-flex", marginTop: 1 }}>
                <Icon name="attention" size={16} />
              </span>
              <span
                style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.5, color: "var(--color-attention-fg)" }}
              >
                Yesterday&rsquo;s exam is still waiting to send. Connect to Wi-Fi to finish — your
                answers are safe.
              </span>
            </div>
          ) : null}

          {/* Exam day offline: exam card pins above Continue (d3c) */}
          {!online ? <ExamCard pinned /> : null}

          <ContinueCard online={online} demoted={!online} />

          {online ? <ExamCard /> : null}

          <div style={{ ...EYEBROW, marginTop: 4 }}>My courses</div>

          {/* Math 8 — on this phone */}
          <CourseRow
            href="/courses/math-8"
            title="Math 8"
            sub="8 chapters · 88% done"
            tileTint
            trailing={
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
            }
          />

          {/* Filipino 8 — not downloaded; action grays offline, row stays readable */}
          <CourseRow
            href="/courses/filipino-8"
            title="Filipino 8"
            dimmed={!online && filipinoDl !== "done"}
            sub={
              filipinoDl === "done"
                ? "9 chapters · 31 MB · on this phone"
                : filipinoDl === "downloading"
                  ? `${Math.round((filipinoPct / 100) * 31)} of 31 MB`
                  : online
                    ? "Not on this phone yet"
                    : "Needs connection to download · 31 MB"
            }
            subFaint={!online && filipinoDl === "idle"}
            progress={filipinoDl === "downloading" ? filipinoPct : undefined}
            trailing={
              filipinoDl === "done" ? (
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
              ) : filipinoDl === "downloading" ? (
                <span className="rl-num" style={{ color: "var(--color-primary)", fontSize: 11.5, fontWeight: 700 }}>
                  {Math.round(filipinoPct)}%
                </span>
              ) : (
                <button
                  type="button"
                  className="home-row-action"
                  disabled={!online}
                  aria-label={online ? "Download Filipino 8 · 31 MB" : "Download Filipino 8 later — needs connection"}
                  onClick={() => {
                    setFilipinoDl("downloading");
                    setFilipinoPct(2);
                  }}
                  style={{ color: online ? "var(--color-primary)" : "var(--color-ink-faint)" }}
                >
                  <Icon name="download" size={13} />
                  {online ? "Get · 31 MB" : "Get later"}
                </button>
              )
            }
          />

          {/* MY BADGES (p1c) */}
          <div style={{ display: "flex", alignItems: "center", marginTop: 4 }}>
            <div style={{ ...EYEBROW, flex: 1 }}>My badges</div>
            <Link
              href="/wallet"
              style={{ fontSize: 11.5, fontWeight: 700, color: "var(--color-primary)", textDecoration: "none" }}
            >
              See wallet →
            </Link>
          </div>
          <div
            style={{ display: "flex", gap: 10 }}
            aria-label="Badges: Science 8 earned, Math 8 earned, Filipino 8 in progress"
          >
            <BadgeDot label="S8" earned />
            <BadgeDot label="M8" earned />
            <BadgeDot label="F8" />
          </div>

          {/* p3f — install onboarding, folded in as a banner */}
          {!installDismissed ? (
            <div className="rl-card" style={{ borderWidth: 1.5, padding: "13px 14px", marginTop: 4 }}>
              <div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    background: "var(--color-primary)",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    boxShadow: "0 8px 20px rgba(30,74,194,0.25)",
                  }}
                >
                  <Icon name="course" size={20} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800 }}>
                    Put Resilient-Learn on your home screen
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--color-ink-subtle)", marginTop: 2, lineHeight: 1.45 }}>
                    One step — it makes offline learning reliable.
                  </div>
                  {iosMode ? (
                    <div style={{ fontSize: 11, color: "var(--color-ink-subtle)", marginTop: 5, lineHeight: 1.5 }}>
                      On iPhone: tap <b>Share</b> → <b>Add to Home Screen</b> — we&rsquo;ll show you
                      exactly where.
                    </div>
                  ) : null}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 11 }}>
                <Button size="small" onClick={() => setInstallDismissed(true)}>
                  Add to home screen
                </Button>
                <Button size="small" variant="quiet" onClick={() => setInstallDismissed(true)}>
                  Maybe later
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* p3f — service-worker update toast (never mid-exam; home is safe) */}
      {updateToast === "shown" ? (
        <div
          role="status"
          style={{
            position: "fixed",
            bottom: 76,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 45,
            width: "max-content",
            maxWidth: "calc(100vw - 32px)",
          }}
        >
          <div className="rl-toast" style={{ gap: 10, paddingRight: 10 }}>
            <span style={{ color: "#8FB0FF", display: "inline-flex" }}>
              <Icon name="download" size={14} />
            </span>
            <span>{copy.environment.updateReady}</span>
            <button type="button" className="home-toast-btn" onClick={() => setUpdateToast("dismissed")}>
              Refresh
            </button>
            <button
              type="button"
              className="home-toast-btn"
              style={{ color: "inherit", opacity: 0.7 }}
              onClick={() => setUpdateToast("dismissed")}
            >
              Later
            </button>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}

/* ---------- Continue learning — top CTA never dead-ends offline ---------- */

function ContinueCard({ online, demoted }: { online: boolean; demoted?: boolean }) {
  return (
    <Link
      href="/courses"
      className="home-continue"
      style={{ opacity: demoted ? 0.92 : 1 }}
    >
      <div className="home-continue__eyebrow">Continue learning</div>
      <div style={{ fontSize: 15.5, fontWeight: 700, marginTop: 5 }}>
        Science 8 · Chapter 3: Weather disturbances
      </div>
      {online ? (
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 10 }}>
          <div className="home-continue__track">
            <div className="home-continue__fill" style={{ width: "62%" }} />
          </div>
          <span className="rl-num home-continue__pct">62%</span>
        </div>
      ) : null}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginTop: 10,
          fontSize: 11.5,
          opacity: 0.9,
        }}
      >
        <Icon name="phone-check" size={12} />
        {online ? "On this phone — works offline" : "On this phone — keep reviewing while offline"}
      </div>
    </Link>
  );
}

/* ---------- Today's exam — chip mirrors the exam lifecycle ---------- */

function ExamCard({ pinned }: { pinned?: boolean }) {
  const card = (
    <div
      style={{
        background: "var(--color-card)",
        border: pinned ? "2px solid var(--color-primary)" : "1.5px solid var(--color-success-border)",
        borderRadius: 14,
        padding: "13px 15px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ ...EYEBROW, flex: 1, color: pinned ? "var(--color-primary)" : EYEBROW.color }}>
          {pinned ? "Today's exam · pinned" : "Today's exam"}
        </div>
        <Chip tone="synced" size="mini" icon={<Icon name="phone-check" size={11} />}>
          Ready offline
        </Chip>
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, marginTop: 6, color: "var(--color-ink)" }}>{exam.title}</div>
      <div style={{ fontSize: 12, color: "var(--color-ink-subtle)", marginTop: 2 }}>
        {pinned ? "Until 5 PM · 30 min · works with zero signal" : "Until 5 PM · 30 min"}
      </div>
      {pinned ? (
        <Link
          href="/exams"
          className="rl-btn rl-btn--primary"
          style={{ height: 46, marginTop: 11, width: "100%", fontSize: 14, fontWeight: 800 }}
        >
          Start exam
        </Link>
      ) : null}
    </div>
  );
  if (pinned) return card;
  return (
    <Link
      href="/exams"
      style={{ textDecoration: "none", display: "block" }}
      aria-label={`Today's exam: ${exam.title} — ready offline`}
    >
      {card}
    </Link>
  );
}

/* ---------- course row — whole row opens; trailing is a separate action ---------- */

function CourseRow({
  href,
  title,
  sub,
  subFaint,
  trailing,
  tileTint,
  dimmed,
  progress,
}: {
  href: string;
  title: string;
  sub: string;
  subFaint?: boolean;
  trailing: React.ReactNode;
  tileTint?: boolean;
  dimmed?: boolean;
  progress?: number;
}) {
  return (
    <div
      className="rl-card"
      style={{
        position: "relative",
        borderWidth: 1.5,
        padding: "12px 14px",
        display: "flex",
        alignItems: "center",
        gap: 11,
        opacity: dimmed ? 0.85 : 1,
      }}
    >
      <Link href={href} aria-label={`Open ${title}`} style={{ position: "absolute", inset: 0, borderRadius: 14 }} />
      <div
        className={`rl-tile ${tileTint ? "rl-tile--tint" : "rl-tile--canvas"}`}
        style={{ width: 38, height: 38 }}
      >
        <Icon name="course" size={17} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>{title}</div>
        <div
          className="rl-num"
          style={{
            fontSize: 11.5,
            color: subFaint ? "var(--color-ink-faint)" : "var(--color-ink-subtle)",
            marginTop: 1,
          }}
        >
          {sub}
        </div>
        {typeof progress === "number" ? (
          <Bar percent={progress} style={{ marginTop: 6 }} aria-label={`${title} download progress`} />
        ) : null}
      </div>
      <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", minHeight: 48 }}>
        {trailing}
      </div>
    </div>
  );
}

function BadgeDot({ label, earned }: { label: string; earned?: boolean }) {
  return (
    <span
      style={{
        width: 46,
        height: 46,
        borderRadius: "50%",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 13,
        fontWeight: 800,
        background: earned ? "var(--color-primary-tint)" : "var(--color-on-device-bg)",
        border: earned ? "2px solid var(--color-primary)" : "2px dashed var(--color-on-device-solid)",
        color: earned ? "var(--color-primary)" : "var(--color-on-device-fg)",
      }}
    >
      {label}
    </span>
  );
}

/* ---------- d3b — first-run hydration (skeletons, never blocking) ---------- */

function HydrationBody() {
  return (
    <div className="page-body">
      <div className="home-hydration-card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 13,
            fontWeight: 700,
            color: "var(--color-primary)",
          }}
        >
          <span>Setting up your offline library</span>
          <span className="rl-num">2.1 of 4 MB</span>
        </div>
        <div
          style={{
            height: 8,
            background: "var(--color-primary-tint)",
            borderRadius: 4,
            marginTop: 9,
            overflow: "hidden",
          }}
          role="progressbar"
          aria-valuenow={52}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Setting up your offline library"
        >
          <div style={{ width: "52%", height: "100%", background: "var(--color-primary)", borderRadius: 4 }} />
        </div>
        <div style={{ fontSize: 12, color: "var(--color-ink-subtle)", marginTop: 8, lineHeight: 1.5 }}>
          You can start now — things appear as they arrive. Wi-Fi only; your data isn&rsquo;t used.
        </div>
      </div>

      <CourseRow
        href="/courses"
        title="Science 8"
        sub="Chapter 1 ready — start reading"
        tileTint
        trailing={
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
            Ready
          </span>
        }
      />

      <SkeletonRow />
      <SkeletonRow />
    </div>
  );
}

/* ---------- local styles (theme-aware; single 720px fork lives in chrome) ---------- */

const homeCss = `
.home-vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;}
.home-continue{display:block;background:var(--color-primary);color:#ffffff;border-radius:14px;padding:14px 15px;text-decoration:none;}
.home-continue__eyebrow{font-size:10.5px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;opacity:0.8;}
.home-continue__track{flex:1;height:7px;background:rgba(255,255,255,0.25);border-radius:4px;overflow:hidden;}
.home-continue__fill{height:100%;background:#ffffff;border-radius:4px;}
.home-continue__pct{font-size:11.5px;font-weight:700;}
[data-theme="dark"] .home-continue{background:#1B2A4E;color:#E7EDF9;}
[data-theme="dark"] .home-continue__eyebrow{color:#8FB0FF;opacity:1;}
[data-theme="dark"] .home-continue__track{background:rgba(143,176,255,0.25);}
[data-theme="dark"] .home-continue__fill{background:#8FB0FF;}
[data-theme="dark"] .home-continue__pct{color:#8FB0FF;}
.home-row-action{display:inline-flex;align-items:center;gap:5px;min-height:48px;padding:0 4px;border:none;background:none;font-family:inherit;font-size:11.5px;font-weight:700;cursor:pointer;}
.home-row-action:disabled{cursor:default;}
.home-toast-btn{border:none;background:none;font-family:inherit;font-size:12.5px;font-weight:700;color:#8FB0FF;cursor:pointer;padding:6px 4px;}
.home-hydration-card{background:var(--color-card);border:1.5px solid #ADC4F5;border-radius:14px;padding:13px 15px;}
[data-theme="dark"] .home-hydration-card{border-color:#2C4270;}
`;
