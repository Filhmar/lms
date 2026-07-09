"use client";

/**
 * Global keyboard shortcuts (KEYS spec §3.2/§3.3) + the "?" shortcuts
 * dialog. Rules honored: shortcuts never fire while typing in a field
 * (except Esc, handled locally by each overlay); single-letter keys never
 * fire with a modifier held; every shortcut has a pointer equivalent.
 * Exam lab mode (body[data-lab-mode]) suppresses navigation shortcuts so
 * `g h` can never pull a student out of a running exam.
 */

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Dialog, Kbd } from "@rl/ui";
import { homeRouteFor, useSession } from "@/lib/session";

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

/** ≥1080px — the desktop layout fork (1366 design floor, holds at 1280). */
export function useDesktop(): boolean {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1080px)");
    const update = () => setDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return desktop;
}

const GO_TIMEOUT_MS = 900;

export function GlobalHotkeys() {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useSession();
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    let goArmedUntil = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Escape") return; // overlays own Esc
      if (isTypingTarget(e.target)) return;
      const labMode = document.body.dataset.labMode === "1";

      if (e.key === "?") {
        e.preventDefault();
        setHelpOpen((o) => !o);
        return;
      }
      if (labMode) return; // no navigation shortcuts mid-exam

      if (e.key === "/") {
        const search = document.querySelector<HTMLInputElement>("[data-hotkey-search]");
        if (search) {
          e.preventDefault();
          search.focus();
          search.select();
        }
        return;
      }
      if (e.key === "g" || e.key === "G") {
        goArmedUntil = Date.now() + GO_TIMEOUT_MS;
        return;
      }
      if ((e.key === "h" || e.key === "H") && Date.now() < goArmedUntil) {
        goArmedUntil = 0;
        e.preventDefault();
        router.push(user ? homeRouteFor(user.role) : "/login");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, user]);

  // close the help dialog on navigation
  useEffect(() => setHelpOpen(false), [pathname]);

  if (!helpOpen) return null;
  return <ShortcutsDialog onClose={() => setHelpOpen(false)} />;
}

/* ------------------------- shortcuts dialog ------------------------- */

function Section({ title, rows }: { title: string; rows: [ReactNode, string][] }) {
  return (
    <div>
      <div className="rl-overline" style={{ letterSpacing: "0.06em" }}>
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 8 }}>
        {rows.map(([keys, what], i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5 }}>
            <span style={{ width: 130, flexShrink: 0, display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
              {keys}
            </span>
            <span style={{ color: "var(--color-ink-secondary)" }}>{what}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog label="Keyboard shortcuts" onClose={onClose} width={560}>
      <div style={{ fontSize: 16, fontWeight: 800 }}>Keyboard shortcuts</div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "16px 20px",
          marginTop: 14,
        }}
      >
        <Section
          title="Global"
          rows={[
            [<Kbd key="k">/</Kbd>, "Focus search"],
            [
              <span key="k" style={{ display: "inline-flex", gap: 4 }}>
                <Kbd>g</Kbd>
                <span style={{ fontSize: 11, color: "var(--color-ink-faint)" }}>then</span>
                <Kbd>h</Kbd>
              </span>,
              "Go home",
            ],
            [<Kbd key="k">?</Kbd>, "Shortcut help"],
            [<Kbd key="k">Esc</Kbd>, "Close dialog / popover / menu"],
          ]}
        />
        <Section
          title="Exam (lab mode)"
          rows={[
            [
              <span key="k" style={{ display: "inline-flex", gap: 4 }}>
                <Kbd>1–4</Kbd>
                <Kbd>A–D</Kbd>
              </span>,
              "Select an answer",
            ],
            [
              <span key="k" style={{ display: "inline-flex", gap: 4 }}>
                <Kbd>←</Kbd>
                <Kbd>→</Kbd>
              </span>,
              "Previous / Next question",
            ],
            [<Kbd key="k">F</Kbd>, "Flag for review"],
            [<Kbd key="k">P</Kbd>, "Focus the palette"],
            [<Kbd key="k">Enter</Kbd>, "Next (Review on last item)"],
          ]}
        />
        <Section
          title="Reading"
          rows={[
            [
              <span key="k" style={{ display: "inline-flex", gap: 4 }}>
                <Kbd>←</Kbd>
                <Kbd>→</Kbd>
              </span>,
              "Previous / Next page",
            ],
            [<Kbd key="k">t</Kbd>, "Toggle TOC rail"],
            [<Kbd key="k">Space</Kbd>, "Play / pause video"],
          ]}
        />
        <Section
          title="Table & tree"
          rows={[
            [
              <span key="k" style={{ display: "inline-flex", gap: 4 }}>
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
              </span>,
              "Move row / node",
            ],
            [
              <span key="k" style={{ display: "inline-flex", gap: 4 }}>
                <Kbd>←</Kbd>
                <Kbd>→</Kbd>
              </span>,
              "Collapse / expand node",
            ],
            [<Kbd key="k">Space</Kbd>, "Toggle row checkbox"],
            [<Kbd key="k">Enter</Kbd>, "Open row / select node"],
          ]}
        />
      </div>
      <button
        type="button"
        data-autofocus
        onClick={onClose}
        style={{
          marginTop: 16,
          height: 40,
          width: "100%",
          border: "1.5px solid var(--color-border)",
          color: "var(--color-ink-subtle)",
          background: "var(--color-card)",
          borderRadius: 999,
          fontSize: 12.5,
          fontWeight: 800,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        Close
      </button>
    </Dialog>
  );
}
