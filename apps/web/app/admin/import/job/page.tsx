"use client";

/**
 * p1h + d6b — Import job progress. Instant "job started", live counts,
 * row-level errors. The lifecycle animates locally to demonstrate the
 * designed states: queued → processing (counts ticking, holding at the
 * spec's 1,240 / 1,183 / 3 / 54 frame) → completed with fixable rows.
 * Counts are monotonic; the polite live region throttles to every 10%.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@rl/ui";
import { AdminShell, Eyebrow, ImportErrorRow, IMPORT_ERROR_ROWS } from "../../ui";

const TOTAL = 1240;
const FAIL_ROWS = [45, 302, 891];
/** Rows processed at the design's mid-run frame: 1,183 created + 3 failed. */
const HOLD_AT = 1186;
const HOLD_MS = 3400;

type Phase = "queued" | "processing" | "done";

const fmt = (n: number) => n.toLocaleString("en-US");

function CountCard({
  eyebrow,
  value,
  tone,
}: {
  eyebrow: string;
  value: number;
  tone?: "created" | "failed";
}) {
  const color =
    tone === "created"
      ? "var(--color-synced-fg)"
      : tone === "failed"
        ? "var(--color-attention-fg)"
        : undefined;
  return (
    <div
      style={{
        background: "var(--color-card)",
        border: `1px solid ${
          tone === "created"
            ? "var(--color-success-border)"
            : tone === "failed"
              ? "var(--color-danger-border)"
              : "var(--color-border)"
        }`,
        borderRadius: 14,
        padding: "14px 16px",
      }}
    >
      <Eyebrow color={color}>{eyebrow}</Eyebrow>
      <div className="rl-num" style={{ fontSize: 24, fontWeight: 800, marginTop: 5, color }}>
        {fmt(value)}
      </div>
    </div>
  );
}

function TimelineStep({
  state,
  label,
}: {
  state: "done" | "active" | "pending";
  label: string;
}) {
  const color =
    state === "done"
      ? "var(--color-synced-fg)"
      : state === "active"
        ? "var(--color-primary)"
        : "var(--color-ink-faint)";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, color }}>
      {state === "done" ? <Icon name="check" size={12} strokeWidth={3} /> : null}
      {label}
    </span>
  );
}

export default function ImportJobPage() {
  const [phase, setPhase] = useState<Phase>("queued");
  const [row, setRow] = useState(0);
  const [runId, setRunId] = useState(0);
  const heldRef = useRef(false);

  /* queued → processing */
  useEffect(() => {
    if (phase !== "queued") return;
    const t = window.setTimeout(() => setPhase("processing"), 1400);
    return () => window.clearTimeout(t);
  }, [phase, runId]);

  /* processing ticker — pauses at the spec's 95% frame, then finishes */
  useEffect(() => {
    if (phase !== "processing") return;
    const iv = window.setInterval(() => {
      setRow((r) => {
        const target = heldRef.current ? TOTAL : HOLD_AT;
        return Math.min(r + 17, target);
      });
    }, 70);
    return () => window.clearInterval(iv);
  }, [phase, runId]);

  useEffect(() => {
    if (phase !== "processing") return;
    if (row === HOLD_AT && !heldRef.current) {
      const t = window.setTimeout(() => {
        heldRef.current = true;
        setRow((r) => r + 1); // nudge the ticker past the hold frame
      }, HOLD_MS);
      return () => window.clearTimeout(t);
    }
    if (row >= TOTAL) setPhase("done");
  }, [row, phase]);

  function replay() {
    heldRef.current = false;
    setRow(0);
    setPhase("queued");
    setRunId((n) => n + 1);
  }

  const failed = FAIL_ROWS.filter((n) => n <= row).length;
  const created = row - failed;
  const remaining = TOTAL - row;
  const pct = phase === "done" ? 100 : Math.floor((row / TOTAL) * 100);

  const etaSeconds = Math.max(5, Math.round((remaining * (40 / 54)) / 5) * 5);
  const etaLabel =
    etaSeconds >= 90 ? `~${Math.round(etaSeconds / 60)} min left` : `~${etaSeconds} s left`;

  /* Polite live region, throttled to every 10% (d6notes a11y). */
  const decile = Math.floor(pct / 10);
  const liveMessage = useMemo(
    () => (phase === "processing" ? `${fmt(created)} of ${fmt(TOTAL)} created` : ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [decile, phase],
  );

  const shownErrors = IMPORT_ERROR_ROWS.filter((e) => e.row <= row);

  return (
    <AdminShell>
      <div style={{ padding: "20px 22px", minHeight: 430 }}>
        {/* Header row */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 17, fontWeight: 800 }}>Import #4127 — SY2026_enrollment.csv</h1>
            <div style={{ fontSize: 12, color: "var(--color-ink-subtle)", marginTop: 2 }}>
              Started 10:42 AM by D. Lopez · target: San Isidro NHS · you can leave this page, the
              import keeps running
            </div>
          </div>
          {phase === "queued" ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "var(--color-canvas)",
                color: "var(--color-ink-secondary)",
                border: "1px solid var(--color-border)",
                borderRadius: 999,
                padding: "7px 13px",
                fontSize: 12,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              <Icon name="clock" size={12} />
              Queued · #1 in line
            </span>
          ) : phase === "processing" ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "var(--color-sending-bg)",
                color: "var(--color-sending-fg)",
                borderRadius: 999,
                padding: "7px 13px",
                fontSize: 12,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              <Icon name="send" size={13} />
              Processing
            </span>
          ) : (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "var(--color-on-device-bg)",
                color: "var(--color-on-device-fg)",
                borderRadius: 999,
                padding: "7px 13px",
                fontSize: 12,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              <Icon name="attention" size={12} />
              Done · 3 to fix
            </span>
          )}
        </div>

        {/* Job timeline */}
        <div style={{ display: "flex", alignItems: "center", marginTop: 14 }}>
          <TimelineStep
            state={phase === "queued" ? "active" : "done"}
            label="Queued 10:42"
          />
          <span
            aria-hidden
            style={{
              width: 40,
              height: 2,
              margin: "0 10px",
              background: phase === "queued" ? "var(--color-border)" : "var(--color-synced-solid)",
            }}
          />
          <TimelineStep
            state={phase === "done" ? "done" : phase === "processing" ? "active" : "pending"}
            label={phase === "done" ? "Processed" : "Processing…"}
          />
          <span
            aria-hidden
            style={{
              width: 40,
              height: 2,
              margin: "0 10px",
              background: phase === "done" ? "var(--color-synced-solid)" : "var(--color-border)",
            }}
          />
          <TimelineStep
            state={phase === "done" ? "done" : "pending"}
            label={phase === "done" ? "Completed 10:45" : "Completed"}
          />
        </div>

        {/* Count cards — server-truth, monotonic */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 12,
            marginTop: 14,
          }}
        >
          <CountCard eyebrow="Total rows" value={TOTAL} />
          <CountCard eyebrow="Created" value={created} tone="created" />
          <CountCard eyebrow="Failed" value={failed} tone="failed" />
          <CountCard eyebrow="Remaining" value={remaining} />
        </div>

        {/* Progress card */}
        <div
          style={{
            background: "var(--color-card)",
            border: "1px solid var(--color-border)",
            borderRadius: 14,
            padding: "14px 16px",
            marginTop: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 12,
              fontWeight: 700,
              color: phase === "done" ? "var(--color-synced-fg)" : "var(--color-primary)",
            }}
          >
            {phase === "queued" ? (
              <>
                <span>Waiting to start</span>
                <span>starts in seconds — safe to close this page</span>
              </>
            ) : phase === "processing" ? (
              <>
                <span className="rl-num">{pct}% done</span>
                <span className="rl-num">{etaLabel}</span>
              </>
            ) : (
              <>
                <span className="rl-num">1,237 of 1,240 created</span>
                <span>Done</span>
              </>
            )}
          </div>
          <div
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            style={{
              height: 8,
              background: "var(--color-primary-tint)",
              borderRadius: 4,
              marginTop: 8,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: "100%",
                background: phase === "done" ? "var(--color-synced-solid)" : "var(--color-primary)",
                borderRadius: 4,
              }}
            />
          </div>
          <p role="status" aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", margin: -1 }}>
            {liveMessage}
          </p>
        </div>

        {/* Error panel — actionable objects, not log lines */}
        {shownErrors.length > 0 ? (
          <div
            style={{
              background: "var(--color-card)",
              border: "1px solid var(--color-border)",
              borderRadius: 14,
              padding: "14px 16px",
              marginTop: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, flex: 1 }}>
                Rows that need a fix ({shownErrors.length})
              </div>
              <button
                type="button"
                style={{
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--color-primary)",
                  padding: 0,
                }}
              >
                Download error report
              </button>
              <button
                type="button"
                style={{
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--color-primary)",
                  padding: 0,
                }}
              >
                Fix &amp; retry failed rows
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 11 }}>
              {shownErrors.map((e) => (
                <ImportErrorRow
                  key={e.row}
                  row={e.row}
                  message={e.message}
                  badValue={"badValue" in e ? e.badValue : undefined}
                  action="Edit row"
                />
              ))}
            </div>
            {phase === "done" ? (
              <p
                style={{
                  fontSize: 11.5,
                  color: "var(--color-ink-subtle)",
                  lineHeight: 1.5,
                  marginTop: 10,
                  marginBottom: 0,
                }}
              >
                1,237 of 1,240 created · the 3 failed rows are listed above, nothing else was
                affected. &quot;Fix &amp; retry&quot; runs a child job over only these rows, linked
                in the audit trail.
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Job history (d6b) */}
        <Eyebrow style={{ marginTop: 20, marginBottom: 8 }}>Other imports</Eyebrow>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div
            style={{
              background: "var(--color-card)",
              border: "1px solid var(--color-border)",
              borderRadius: 14,
              padding: "14px 16px",
              display: "flex",
              alignItems: "center",
              gap: 14,
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "var(--color-canvas)",
                color: "var(--color-ink-secondary)",
                border: "1px solid var(--color-border)",
                borderRadius: 999,
                padding: "6px 12px",
                fontSize: 11.5,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              <Icon name="clock" size={12} />
              Queued · #2 in line
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Import #4128 — grade7_sections.csv</div>
              <div style={{ fontSize: 11.5, color: "var(--color-ink-subtle)" }}>
                Starts after #4127 · you&rsquo;ll get a notification — safe to close this page
              </div>
            </div>
            <button
              type="button"
              style={{
                border: "none",
                background: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 12,
                fontWeight: 700,
                color: "var(--color-attention-fg)",
                padding: 0,
                flexShrink: 0,
              }}
            >
              Cancel
            </button>
          </div>

          <div
            style={{
              background: "var(--color-card)",
              border: "1px solid var(--color-success-border)",
              borderRadius: 14,
              padding: "14px 16px",
              display: "flex",
              alignItems: "center",
              gap: 14,
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "var(--color-synced-bg)",
                color: "var(--color-synced-fg)",
                borderRadius: 999,
                padding: "6px 12px",
                fontSize: 11.5,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              <Icon name="check" size={12} strokeWidth={2.8} />
              Completed
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Import #4126 — teachers_batch2.csv</div>
              <div style={{ fontSize: 11.5, color: "var(--color-ink-subtle)" }}>
                312 of 312 created · 2 min 40 s · all invitations sent
              </div>
            </div>
            <Link
              href="/admin/hierarchy"
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "var(--color-primary)",
                textDecoration: "none",
                flexShrink: 0,
              }}
            >
              View users
            </Link>
          </div>
        </div>

        <button
          type="button"
          onClick={replay}
          style={{
            border: "none",
            background: "none",
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: 11,
            color: "var(--color-ink-faint)",
            textDecoration: "underline",
            padding: "16px 0 0",
          }}
        >
          Demo: replay the job lifecycle (queued → processing → completed)
        </button>
      </div>
    </AdminShell>
  );
}
