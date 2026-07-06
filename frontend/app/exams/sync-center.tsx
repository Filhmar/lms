"use client";

/**
 * Sync Center — the trust ledger. One component, two presentations:
 * bottom sheet on phones / anchored popover at ≥720dp (rendered by the
 * caller), plus the standalone /sync route. Chip grammar per the state
 * language: shape + color + verb, never color alone; offline is calm,
 * never an error.
 */

import { Button, Chip, Icon } from "@rl/ui";
import type { Connectivity } from "@/lib/demo";
import * as copy from "@/lib/copy";
import { exam as examFx, outboxExtras, syncPayloadKb } from "@/lib/fixtures";
import { inProgress, pendingExam, TOTAL, type ExamSnapshot } from "./state";

type RowChipKind = "done" | "sending" | "local";

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

export function SyncCenterContent({
  s,
  connectivity,
  onSendNow,
  showTitle = true,
}: {
  s: ExamSnapshot;
  connectivity: Connectivity;
  onSendNow: () => void;
  showTitle?: boolean;
}) {
  const pend = pendingExam(s);
  const offline = connectivity === "offline";

  const examRow = s.submitted
    ? {
        title: `${examFx.subject} exam — answers`,
        sub: pend > 0 ? `${pend} of ${TOTAL} still to send` : `All ${TOTAL} sent`,
        chip: (pend === 0 ? "done" : !offline ? "sending" : "local") as RowChipKind,
      }
    : {
        title: `${examFx.subject} exam`,
        sub: inProgress(s)
          ? "In progress — stays on this phone until you submit"
          : "Not started",
        // Not sent anywhere until submit — always calm amber.
        chip: "local" as RowChipKind,
      };

  const extraRows = outboxExtras.map((x, i) => ({
    title: x.label,
    sub: i === 0 ? `Small update · ${x.size}` : `Becomes official at school · ${x.size}`,
    chip: (s.extraSent >= i + 1 ? "done" : !offline ? "sending" : "local") as RowChipKind,
  }));

  return (
    <div>
      {showTitle ? <div style={{ fontSize: 16, fontWeight: 800 }}>Sync Center</div> : null}
      <div style={{ fontSize: 12, color: "var(--color-ink-subtle)", marginTop: 2 }}>
        This phone · last sent to school: {s.lastSync}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 13 }}>
        <SyncRow {...examRow} />
        {extraRows.map((r) => (
          <SyncRow key={r.title} {...r} />
        ))}
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
      <div
        style={{ fontSize: 11, color: "var(--color-ink-subtle)", textAlign: "center", marginTop: 8 }}
      >
        {copy.syncCenter.dataCost(syncPayloadKb)}
      </div>
    </div>
  );
}
