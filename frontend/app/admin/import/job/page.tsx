"use client";

/**
 * p1h + d6b — Import job progress, wired to the real job:
 * reads ?id=, polls GET /provisioning/job/:id every 2 s until the job is
 * completed or failed, and renders the REAL counts + row errors in the
 * designed components. Counts over adjectives; the polite live region
 * throttles announcements to every 10%.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Icon } from "@rl/ui";
import type { JobStatus, ProvisioningJobStatus } from "@rl/schemas";
import { ApiError, apiGet } from "@/lib/api";
import { AdminChrome, AdminErrorBanner } from "../../chrome";
import { Eyebrow, ImportErrorRow } from "../../ui";

const POLL_MS = 2000;
const fmt = (n: number) => n.toLocaleString("en-US");

function CountCard({
  eyebrow,
  value,
  tone,
}: {
  eyebrow: string;
  value: string;
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
        {value}
      </div>
    </div>
  );
}

function TimelineStep({ state, label }: { state: "done" | "active" | "pending"; label: string }) {
  const color =
    state === "done"
      ? "var(--color-synced-fg)"
      : state === "active"
        ? "var(--color-primary)"
        : "var(--color-ink-faint)";
  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, color }}
    >
      {state === "done" ? <Icon name="check" size={12} strokeWidth={3} /> : null}
      {label}
    </span>
  );
}

function StatusPill({ status, failedRows }: { status: JobStatus; failedRows: number }) {
  if (status === "queued") {
    return (
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
        Queued
      </span>
    );
  }
  if (status === "processing") {
    return (
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
    );
  }
  if (status === "failed") {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: "var(--color-attention-bg)",
          color: "var(--color-attention-fg)",
          borderRadius: 999,
          padding: "7px 13px",
          fontSize: 12,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        <Icon name="attention" size={12} />
        Stopped — see details
      </span>
    );
  }
  return failedRows > 0 ? (
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
      Done · {fmt(failedRows)} to fix
    </span>
  ) : (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: "var(--color-synced-bg)",
        color: "var(--color-synced-fg)",
        borderRadius: 999,
        padding: "7px 13px",
        fontSize: 12,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      <Icon name="check" size={12} strokeWidth={2.8} />
      Completed
    </span>
  );
}

export default function ImportJobPage() {
  return (
    <AdminChrome title="Import job">
      <Suspense fallback={null}>
        <ImportJobBody />
      </Suspense>
    </AdminChrome>
  );
}

function ImportJobBody() {
  const params = useSearchParams();
  const jobId = params.get("id");

  const [job, setJob] = useState<ProvisioningJobStatus | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [reachError, setReachError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let timer: number | undefined;

    async function poll() {
      try {
        const next = await apiGet<ProvisioningJobStatus>(`/provisioning/job/${jobId}`);
        if (cancelled) return;
        setJob(next);
        setReachError(null);
        if (next.status === "completed" || next.status === "failed") return; // stop polling
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 404 || err.status === 400)) {
          setNotFound(true);
          return; // stop polling — the id is wrong
        }
        if (err instanceof ApiError && err.status === 403) {
          setReachError(err.message);
          return; // outside scope — stop
        }
        setReachError("Can't reach the job right now — still trying. The import keeps running either way.");
      }
      timer = window.setTimeout(() => void poll(), POLL_MS);
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [jobId]);

  /* ---------------- empty / error states ---------------- */
  if (!jobId) {
    return (
      <EmptyCard
        title="No import selected"
        body="Open a job from its start screen, or begin a new import."
      />
    );
  }
  if (notFound) {
    return (
      <EmptyCard
        title="That import wasn't found"
        body="The job id in this link doesn't match a job you can see. Start a new import, or check the link."
      />
    );
  }

  const status: JobStatus = job?.status ?? "queued";
  const total = job?.progress.total ?? 0;
  const success = job?.progress.success ?? 0;
  const failed = job?.progress.failed ?? 0;
  const processed = success + failed;
  const remaining = Math.max(0, total - processed);
  const pct =
    status === "completed"
      ? 100
      : total > 0
        ? Math.floor((processed / total) * 100)
        : 0;

  return (
    <div style={{ padding: "20px 22px", minHeight: 430 }}>
      <style>{jobCss}</style>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 17, fontWeight: 800, overflowWrap: "anywhere" }}>
            Import job <span className="rl-num">{jobId.slice(0, 8)}</span>
          </h1>
          <div style={{ fontSize: 12, color: "var(--color-ink-subtle)", marginTop: 2 }}>
            You can leave this page — the import keeps running in the background.
          </div>
        </div>
        <StatusPill status={status} failedRows={failed} />
      </div>

      {reachError ? (
        <div style={{ marginTop: 12 }}>
          <AdminErrorBanner>{reachError}</AdminErrorBanner>
        </div>
      ) : null}

      {/* Job timeline */}
      <div style={{ display: "flex", alignItems: "center", marginTop: 14 }}>
        <TimelineStep state={status === "queued" ? "active" : "done"} label="Queued" />
        <span
          aria-hidden
          style={{
            width: 40,
            height: 2,
            margin: "0 10px",
            background: status === "queued" ? "var(--color-border)" : "var(--color-synced-solid)",
          }}
        />
        <TimelineStep
          state={
            status === "completed" || status === "failed"
              ? "done"
              : status === "processing"
                ? "active"
                : "pending"
          }
          label={status === "processing" ? "Processing…" : "Processed"}
        />
        <span
          aria-hidden
          style={{
            width: 40,
            height: 2,
            margin: "0 10px",
            background:
              status === "completed" || status === "failed"
                ? "var(--color-synced-solid)"
                : "var(--color-border)",
          }}
        />
        <TimelineStep
          state={status === "completed" || status === "failed" ? "done" : "pending"}
          label={status === "failed" ? "Stopped" : "Completed"}
        />
      </div>

      {/* Count cards — server truth. 4-across; phones (<720px) stack 2×2 */}
      <div className="impjob-stats" style={{ marginTop: 14 }}>
        <CountCard eyebrow="Total rows" value={job ? fmt(total) : "—"} />
        <CountCard eyebrow="Created" value={job ? fmt(success) : "—"} tone="created" />
        <CountCard eyebrow="Rows to fix" value={job ? fmt(failed) : "—"} tone="failed" />
        <CountCard eyebrow="Remaining" value={job ? fmt(remaining) : "—"} />
      </div>

      {/* Progress card */}
      <div
        style={{
          background: "var(--color-card)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
          padding: "14px 16px",
          marginTop: 12,
          position: "relative",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 12,
            fontWeight: 700,
            color: status === "completed" ? "var(--color-synced-fg)" : "var(--color-primary)",
          }}
        >
          {status === "queued" ? (
            <>
              <span>Waiting to start</span>
              <span>starts in seconds — safe to close this page</span>
            </>
          ) : status === "processing" ? (
            <>
              <span className="rl-num">
                {fmt(processed)} of {fmt(total)} processed
              </span>
              <span className="rl-num">{pct}%</span>
            </>
          ) : status === "failed" ? (
            <>
              <span className="rl-num" style={{ color: "var(--color-attention-fg)" }}>
                {fmt(success)} of {fmt(total)} created before the job stopped
              </span>
              <span style={{ color: "var(--color-attention-fg)" }}>Stopped</span>
            </>
          ) : (
            <>
              <span className="rl-num">
                {fmt(success)} of {fmt(total)} created
              </span>
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
              background:
                status === "completed" ? "var(--color-synced-solid)" : "var(--color-primary)",
              borderRadius: 4,
              transition: "width 300ms ease",
            }}
          />
        </div>
        <LiveRegion status={status} success={success} total={total} pct={pct} />
      </div>

      {/* Error panel — actionable objects, not log lines */}
      {job && job.errors.length > 0 ? (
        <div
          style={{
            background: "var(--color-card)",
            border: "1px solid var(--color-border)",
            borderRadius: 14,
            padding: "14px 16px",
            marginTop: 12,
          }}
        >
          <div style={{ fontSize: 12.5, fontWeight: 800 }}>
            Rows that need a fix ({fmt(job.errors.length)})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 11 }}>
            {job.errors.map((e) => (
              <ImportErrorRow key={e.row} row={e.row} message={e.reason} />
            ))}
          </div>
          <p
            style={{
              fontSize: 11.5,
              color: "var(--color-ink-subtle)",
              lineHeight: 1.5,
              marginTop: 10,
              marginBottom: 0,
            }}
          >
            Fix these rows in your spreadsheet and import just those rows as a new file — clean rows
            were created and won&rsquo;t be doubled.
          </p>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 12, marginTop: 20, alignItems: "center" }}>
        <Link
          href="/admin/import"
          style={{
            height: 44,
            padding: "0 18px",
            background: "var(--color-primary)",
            color: "#ffffff",
            borderRadius: 999,
            fontSize: 13,
            fontWeight: 800,
            display: "inline-flex",
            alignItems: "center",
            textDecoration: "none",
          }}
        >
          Start another import
        </Link>
        <Link
          href="/admin/users"
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "var(--color-primary)",
            textDecoration: "none",
          }}
        >
          View users →
        </Link>
      </div>
    </div>
  );
}

/** Polite live region, throttled to every 10% (d6notes a11y). */
function LiveRegion({
  status,
  success,
  total,
  pct,
}: {
  status: JobStatus;
  success: number;
  total: number;
  pct: number;
}) {
  const decile = Math.floor(pct / 10);
  const message = useMemo(
    () =>
      status === "processing" ? `${fmt(success)} of ${fmt(total)} created` : "",
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [decile, status],
  );
  return (
    <p
      role="status"
      aria-live="polite"
      style={{
        position: "absolute",
        width: 1,
        height: 1,
        overflow: "hidden",
        clip: "rect(0 0 0 0)",
        margin: -1,
      }}
    >
      {message}
    </p>
  );
}

function EmptyCard({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "56px 22px" }}>
      <div
        style={{
          background: "var(--color-card)",
          border: "1.5px solid var(--color-border)",
          borderRadius: 16,
          padding: "24px 20px",
          textAlign: "center",
          width: 400,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 800 }}>{title}</h2>
        <p style={{ fontSize: 12.5, color: "var(--color-ink-subtle)", lineHeight: 1.55, marginTop: 6 }}>
          {body}
        </p>
        <Link
          href="/admin/import"
          style={{
            height: 42,
            marginTop: 14,
            background: "var(--color-primary)",
            color: "#ffffff",
            borderRadius: 999,
            padding: "0 18px",
            fontSize: 12.5,
            fontWeight: 800,
            display: "inline-flex",
            alignItems: "center",
            textDecoration: "none",
          }}
        >
          Go to the import wizard
        </Link>
      </div>
    </div>
  );
}

/* Desktop layout as designed; phones (<720px) stack the count cards 2×2. */
const jobCss = `
.impjob-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;}
@media (max-width:719px){.impjob-stats{grid-template-columns:repeat(2,minmax(0,1fr));}}
`;
