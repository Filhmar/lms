"use client";

/**
 * Sync Center — the trust ledger, now reading the REAL outbox. One
 * component, two presentations: bottom sheet on phones / anchored popover at
 * ≥720dp (rendered by the caller), plus the standalone /sync route.
 * Chip grammar per the state language: shape + color + verb, never color
 * alone; offline is calm, never an error. Rows cover exam events plus a
 * rolled-up "Reading progress" row for pending course completions (the
 * course engine shares this outbox).
 */

import { useEffect, useState } from "react";
import { Button, Chip, Icon } from "@rl/ui";
import * as copy from "@/lib/copy";
import { countAnswered, type EngineState } from "@/lib/exam/engine";
import { fmtLastSync } from "./state";

type RowChipKind = "done" | "sending" | "local" | "attention";

function StatusChip({ kind }: { kind: RowChipKind }) {
  if (kind === "done")
    return (
      <Chip tone="synced" size="compact" icon={<Icon name="cloud-check" size={11} />}>
        At school ✓
      </Chip>
    );
  if (kind === "sending")
    return (
      <Chip tone="sending" size="compact" icon={<Icon name="send" size={11} />}>
        Sending…
      </Chip>
    );
  if (kind === "attention")
    return (
      <Chip tone="attention" size="compact" icon={<Icon name="attention" size={11} />}>
        Ask your teacher
      </Chip>
    );
  return (
    <Chip tone="on-device" size="compact" icon={<Icon name="phone-check" size={11} />}>
      On this phone
    </Chip>
  );
}

function SyncRow({ title, sub, chip }: { title: string; sub: string; chip: RowChipKind }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 11,
        border: "1.5px solid var(--color-border)",
        borderRadius: 12,
        padding: "11px 12px",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 11.5, color: "var(--color-ink-subtle)", marginTop: 1 }}>{sub}</div>
      </div>
      <StatusChip kind={chip} />
    </div>
  );
}

interface Row {
  key: string;
  title: string;
  sub: string;
  chip: RowChipKind;
}

function buildRows(eng: EngineState): Row[] {
  const offline = !eng.online;
  const rows: Row[] = [];
  if (eng.outbox.progressPending > 0) {
    const n = eng.outbox.progressPending;
    rows.push({
      key: "reading-progress",
      title: "Reading progress",
      sub: `${n} page${n === 1 ? "" : "s"} finished — still to send`,
      chip: offline ? "local" : "sending",
    });
  }
  const attemptRows = Object.values(eng.attempts).map((att) => {
    const title = eng.packages[att.examId]?.title ?? "Exam";
    if (att.state === "in_progress") {
      return {
        key: att.attemptId,
        title,
        sub: "In progress — stays on this phone until you submit",
        chip: "local" as const,
      };
    }
    const ob = eng.outbox.byAttempt[att.attemptId];
    if (ob && ob.rejected > 0) {
      return {
        key: att.attemptId,
        title: `${title} — answers`,
        sub: `${ob.rejected} couldn’t be counted — ask your teacher`,
        chip: "attention" as const,
      };
    }
    const answered = countAnswered(att);
    const pend = ob?.pendingAnswers ?? 0;
    const allSent = pend === 0 && !ob?.submitPending;
    return {
      key: att.attemptId,
      title: `${title} — answers`,
      sub: allSent ? `All ${answered} sent` : `${pend} of ${answered} still to send`,
      chip: allSent ? ("done" as const) : offline ? ("local" as const) : ("sending" as const),
    };
  });
  return [...rows, ...attemptRows];
}

export function SyncCenterContent({
  eng,
  onSendNow,
  showTitle = true,
  device = "phone",
}: {
  eng: EngineState;
  onSendNow: () => void;
  showTitle?: boolean;
  /** Device noun — "computer" on lab machines (desktop spec §6). */
  device?: "phone" | "computer";
}) {
  const offline = !eng.online;
  const rows = buildRows(eng);
  const kb = Math.max(1, Math.round(eng.outbox.pendingBytes / 1024));

  // "just now" needs a clock that moves while the sheet is open.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div>
      {showTitle ? <div style={{ fontSize: 16, fontWeight: 800 }}>Sync Center</div> : null}
      <div style={{ fontSize: 12, color: "var(--color-ink-subtle)", marginTop: 2 }}>
        This {device} · last sent to school: {fmtLastSync(eng.outbox.lastSentMs, nowMs)}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 13 }}>
        {rows.length === 0 ? (
          <div
            style={{
              border: "1.5px dashed var(--color-border)",
              borderRadius: 12,
              padding: "14px 12px",
              fontSize: 12.5,
              lineHeight: 1.5,
              color: "var(--color-ink-subtle)",
              textAlign: "center",
            }}
          >
            Nothing waiting to send — your work saves on this phone first.
          </div>
        ) : (
          rows.map((row) => (
            <SyncRow key={row.key} title={row.title} sub={row.sub} chip={row.chip} />
          ))
        )}
      </div>
      <Button
        style={{ width: "100%", height: 50, marginTop: 14, fontSize: 15, fontWeight: 800 }}
        disabled={offline}
        onClick={onSendNow}
      >
        Send now
      </Button>
      {offline ? (
        <div
          style={{
            fontSize: 12,
            color: "var(--color-ink-subtle)",
            textAlign: "center",
            lineHeight: 1.5,
            marginTop: 8,
          }}
        >
          {copy.syncCenter.sendNowOffline}
        </div>
      ) : null}
      {eng.outbox.pending > 0 ? (
        <div
          style={{ fontSize: 11, color: "var(--color-ink-subtle)", textAlign: "center", marginTop: 8 }}
        >
          {copy.syncCenter.dataCost(kb)}
        </div>
      ) : null}
    </div>
  );
}
