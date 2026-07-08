/**
 * Exam journey UI strings + formatting helpers.
 *
 * The localStorage demo driver that used to live here is gone — the journey
 * now runs on the real offline-first engine (lib/exam: IndexedDB repository,
 * envelope encryption at write time, outbox drip sync). Only the pieces the
 * UI still owns remain: verbatim spec strings and display formatting.
 */

/** Palette cell input: null/"" = blank, anything else = answered. */
export type Answer = number | string | null;

/* ---------- formatting ---------- */

/** m:ss — minutes unpadded ("30:00", "1:05"), render with tabular numerals. */
export function fmtClock(totalSeconds: number): string {
  const sec = Math.max(0, totalSeconds);
  const m = Math.floor(sec / 60);
  const ss = String(sec % 60).padStart(2, "0");
  return `${m}:${ss}`;
}

/** Approximate download size for display — "3 KB" / "1.2 MB". */
export function fmtSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** "until 5 PM" same-day, else "until Aug 7". */
export function fmtClosesHint(iso: string, nowMs: number): string {
  const d = new Date(iso);
  const now = new Date(nowMs);
  if (d.toDateString() === now.toDateString()) {
    const t = d.toLocaleTimeString("en-US", {
      hour: "numeric",
      ...(d.getMinutes() !== 0 ? { minute: "2-digit" as const } : {}),
    });
    return `until ${t}`;
  }
  return `until ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

/** "opens Mon" within the week, else "opens Jul 13". */
export function fmtOpensHint(iso: string, nowMs: number): string {
  const d = new Date(iso);
  const days = (d.getTime() - nowMs) / 86_400_000;
  if (days <= 6) {
    return `opens ${d.toLocaleDateString("en-US", { weekday: "short" })}`;
  }
  return `opens ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

/** "July 13" — the release date in the Coming-up card sub-line. */
export function fmtLongDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });
}

/** Last successful send, for the Sync Center header line. */
export function fmtLastSync(lastSentMs: number | null, nowMs: number): string {
  if (lastSentMs === null) return "not yet";
  if (nowMs - lastSentMs < 90_000) return "just now";
  const d = new Date(lastSentMs);
  const now = new Date(nowMs);
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  if (d.toDateString() === now.toDateString()) return `today, ${time}`;
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${time}`;
}

/** "Science 8 · Quarter 2 Periodical" → overline "Science 8", heading rest. */
export function splitTitle(title: string): { over: string; head: string } {
  const i = title.indexOf("·");
  if (i > 0) {
    return { over: title.slice(0, i).trim(), head: title.slice(i + 1).trim() };
  }
  return { over: "Exam", head: title };
}

/* ---------- journey strings not in the shared copy module ----------
   Verbatim from the exam-journey spec §9 (middots ·, em dashes —,
   single-char ellipses …, typographic apostrophes ’). */

export const strings = {
  toastSaved: "Saved on this phone",
  toastFlagged: "Flagged for review",
  toastUnflagged: "Flag removed",
  toastTimesUp: "Time’s up — everything you answered was submitted",
  toastAllSent: "Everything sent to school",
  sendingLeft: (n: number) => `Sending… ${n} left`,
} as const;
