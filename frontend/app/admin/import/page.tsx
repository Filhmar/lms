"use client";

/**
 * p1g + d6a — Bulk CSV import wizard. Validate before anything runs;
 * never a spinner. Structure is checked instantly on upload (a bad file
 * never creates a job); scope is picked and locked at confirm; "Start
 * import" returns a job id immediately (202 pattern) with a link to the
 * job screen — the admin is never held on a blocking request.
 */

import { useState } from "react";
import Link from "next/link";
import { Chip, Icon } from "@rl/ui";
import { AdminShell, Eyebrow, ImportErrorRow, IMPORT_ERROR_ROWS, MONO } from "../ui";

type Phase = "upload" | "review" | "confirm" | "started";

const SCHOOLS = [
  "San Isidro National High School",
  "Dasmariñas East ES",
  "Salawag Integrated School",
] as const;

/* ------------------------------------------------------------------ */
/* Stepper — an ordered list with aria-current (per d6notes a11y).     */
/* ------------------------------------------------------------------ */

const STEPS = ["Upload", "Check file", "Choose scope", "Confirm"] as const;

function Stepper({ active }: { active: number /* 1-based; 5 = all done */ }) {
  return (
    <ol
      style={{
        display: "flex",
        alignItems: "center",
        listStyle: "none",
        padding: 0,
        margin: "0 0 18px",
      }}
    >
      {STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < active;
        const current = n === active;
        const nextDone = n + 1 < active;
        const nextCurrent = n + 1 === active;
        return (
          <li
            key={label}
            aria-current={current ? "step" : undefined}
            style={{ display: "flex", alignItems: "center" }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                aria-hidden
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  ...(done
                    ? { background: "var(--color-synced-solid)", color: "#ffffff" }
                    : current
                      ? {
                          background: "var(--color-primary)",
                          color: "#ffffff",
                          fontSize: 12,
                          fontWeight: 800,
                        }
                      : {
                          border: "2px solid var(--color-border)",
                          color: "var(--color-ink-faint)",
                          fontSize: 12,
                          fontWeight: 800,
                        }),
                }}
              >
                {done ? <Icon name="check" size={13} strokeWidth={3} /> : n}
              </span>
              <span
                style={{
                  fontSize: 12.5,
                  fontWeight: current ? 800 : 700,
                  color: current
                    ? "var(--color-primary)"
                    : done
                      ? "var(--color-ink)"
                      : "var(--color-ink-faint)",
                }}
              >
                {label}
              </span>
            </span>
            {n < STEPS.length ? (
              <span
                aria-hidden
                style={{
                  width: 56,
                  height: 2,
                  margin: "0 10px",
                  background:
                    done && nextDone
                      ? "var(--color-synced-solid)"
                      : done && nextCurrent
                        ? "var(--color-primary)"
                        : "var(--color-border)",
                }}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ */

const panelStyle: React.CSSProperties = {
  background: "var(--color-card)",
  border: "1px solid var(--color-border)",
  borderRadius: 14,
  padding: 16,
};

export default function ImportWizardPage() {
  const [phase, setPhase] = useState<Phase>("upload");
  const [scope, setScope] = useState<string>(SCHOOLS[0]);

  return (
    <AdminShell>
      <div style={{ padding: "20px 22px", minHeight: 480 }}>
        <Stepper
          active={phase === "upload" ? 1 : phase === "review" ? 3 : phase === "confirm" ? 4 : 5}
        />

        {phase === "upload" ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {/* Dropzone */}
            <button
              type="button"
              onClick={() => setPhase("review")}
              style={{
                background: "var(--color-card)",
                border: "2px dashed #ADC4F5",
                borderRadius: 14,
                padding: "28px 20px",
                textAlign: "center",
                cursor: "pointer",
                fontFamily: "inherit",
                color: "inherit",
              }}
            >
              <span
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: "50%",
                  background: "var(--color-primary-tint)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--color-primary)",
                }}
              >
                <Icon name="send" size={26} />
              </span>
              <div style={{ fontSize: 15, fontWeight: 800, marginTop: 12 }}>Drop your CSV here</div>
              <div style={{ fontSize: 12, color: "var(--color-ink-subtle)", marginTop: 4 }}>
                or <strong style={{ color: "var(--color-primary)" }}>browse files</strong> · up to
                50,000 rows
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  color: "var(--color-ink-subtle)",
                  marginTop: 14,
                  lineHeight: 1.6,
                }}
              >
                Needs columns:{" "}
                <span
                  style={{
                    fontFamily: MONO,
                    background: "var(--color-canvas)",
                    padding: "2px 6px",
                    borderRadius: 5,
                  }}
                >
                  learner_id · first_name · last_name · email · grade_level · section
                </span>
              </div>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  height: 38,
                  padding: "0 16px",
                  border: "1.5px solid var(--color-primary)",
                  color: "var(--color-primary)",
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 800,
                  marginTop: 12,
                }}
              >
                Download the template
              </span>
            </button>

            {/* Failed structure check — a bad file never creates a job */}
            <div
              style={{
                background: "var(--color-card)",
                border: "1.5px solid var(--color-danger-border)",
                borderRadius: 14,
                padding: "18px 20px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                <span
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background: "var(--color-attention-bg)",
                    color: "var(--color-attention-fg)",
                    fontSize: 10,
                    fontWeight: 800,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  CSV
                </span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>enrollment_draft.csv</div>
                  <div style={{ fontSize: 11.5, color: "var(--color-ink-subtle)" }}>
                    1,240 rows · checked instantly, before anything runs
                  </div>
                </div>
              </div>

              <div
                style={{
                  background: "var(--color-attention-bg)",
                  border: "1px solid var(--color-danger-border)",
                  borderRadius: 10,
                  padding: "11px 13px",
                  marginTop: 13,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    fontSize: 13,
                    fontWeight: 800,
                    color: "var(--color-attention-fg)",
                  }}
                >
                  <Icon name="attention" size={14} />
                  This file can&rsquo;t be imported yet
                </div>
                <ul
                  style={{
                    fontSize: 12,
                    color: "var(--color-ink-secondary)",
                    lineHeight: 1.6,
                    marginTop: 6,
                    paddingLeft: 18,
                    marginBottom: 0,
                  }}
                >
                  <li>
                    Missing column: <span style={{ fontFamily: MONO }}>grade_level</span>
                  </li>
                  <li>
                    Column 4 is named <span style={{ fontFamily: MONO }}>&quot;e-mail&quot;</span> —
                    expected <span style={{ fontFamily: MONO }}>&quot;email&quot;</span>
                  </li>
                </ul>
              </div>

              <p
                style={{
                  fontSize: 11.5,
                  color: "var(--color-ink-subtle)",
                  lineHeight: 1.55,
                  marginTop: 10,
                }}
              >
                Fix the headers in your spreadsheet and re-upload. Nothing was created — structure
                is checked before any job starts.
              </p>

              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  onClick={() => setPhase("review")}
                  style={{
                    height: 40,
                    flex: 1,
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 800,
                    border: "1.5px solid var(--color-border)",
                    color: "var(--color-ink-subtle)",
                    background: "var(--color-card)",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Replace file
                </button>
                <button
                  type="button"
                  disabled
                  style={{
                    height: 40,
                    flex: 1,
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 800,
                    border: "none",
                    background: "var(--color-disabled-bg)",
                    color: "var(--color-disabled-fg)",
                    cursor: "not-allowed",
                    fontFamily: "inherit",
                  }}
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {phase === "review" ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {/* Panel A — file check results */}
            <div style={panelStyle}>
              <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                <span
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background: "var(--color-primary-tint)",
                    color: "var(--color-primary)",
                    fontSize: 10,
                    fontWeight: 800,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  CSV
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>SY2026_enrollment.csv</div>
                  <div style={{ fontSize: 11.5, color: "var(--color-ink-subtle)" }}>
                    1,240 rows · 214 KB · checked in 2 s
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPhase("upload")}
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
                  Replace file
                </button>
              </div>

              {/* Summary tiles */}
              <div style={{ display: "flex", gap: 8, marginTop: 13 }}>
                <div
                  style={{
                    background: "#EEF9F1",
                    border: "1px solid var(--color-success-border)",
                    borderRadius: 10,
                    padding: "10px 12px",
                    flex: 1,
                  }}
                >
                  <div
                    className="rl-num"
                    style={{ fontSize: 20, fontWeight: 800, color: "var(--color-synced-fg)" }}
                  >
                    1,237
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-synced-fg)" }}>
                    rows ready
                  </div>
                </div>
                <div
                  style={{
                    background: "var(--color-danger-surface)",
                    border: "1px solid var(--color-danger-border)",
                    borderRadius: 10,
                    padding: "10px 12px",
                    flex: 1,
                  }}
                >
                  <div
                    className="rl-num"
                    style={{ fontSize: 20, fontWeight: 800, color: "var(--color-attention-fg)" }}
                  >
                    3
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-attention-fg)" }}>
                    need a fix
                  </div>
                </div>
              </div>

              {/* Error rows */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 11 }}>
                {IMPORT_ERROR_ROWS.map((e) => (
                  <ImportErrorRow
                    key={e.row}
                    row={e.row}
                    message={e.message}
                    badValue={"badValue" in e ? e.badValue : undefined}
                    action="Fix"
                  />
                ))}
              </div>

              <p
                style={{
                  fontSize: 11.5,
                  color: "var(--color-ink-subtle)",
                  lineHeight: 1.5,
                  marginTop: 10,
                }}
              >
                You can import the 1,237 clean rows now and fix these 3 later — nothing blocks.
              </p>
            </div>

            {/* Panel B — scope picker */}
            <div style={{ ...panelStyle, display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 13, fontWeight: 800 }}>Where do these users belong?</div>
              <div style={{ fontSize: 11.5, color: "var(--color-ink-subtle)", marginTop: 2 }}>
                New accounts are created inside this scope only.
              </div>

              {/* Mini scope tree */}
              <div
                style={{
                  marginTop: 12,
                  border: "1px solid var(--color-border)",
                  borderRadius: 10,
                  padding: 8,
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                <div style={{ padding: "7px 10px", color: "var(--color-ink-faint)" }}>
                  Division of Cavite
                </div>
                <div
                  style={{
                    padding: "7px 10px 7px 24px",
                    color: "var(--color-ink-secondary)",
                  }}
                >
                  ▾ Dasmariñas District
                </div>
                {SCHOOLS.map((s) => {
                  const selected = scope === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setScope(s)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        width: "100%",
                        textAlign: "left",
                        padding: "7px 10px 7px 40px",
                        border: "none",
                        cursor: "pointer",
                        fontFamily: "inherit",
                        fontSize: 13,
                        fontWeight: 600,
                        borderRadius: 8,
                        background: selected ? "var(--color-primary-tint)" : "none",
                        color: selected ? "var(--color-primary)" : "var(--color-ink-secondary)",
                      }}
                    >
                      {selected ? (
                        <span
                          aria-hidden
                          style={{
                            width: 16,
                            height: 16,
                            borderRadius: "50%",
                            background: "var(--color-primary)",
                            color: "#ffffff",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          <Icon name="check" size={9} strokeWidth={4} />
                        </span>
                      ) : (
                        <span
                          aria-hidden
                          style={{
                            width: 16,
                            height: 16,
                            borderRadius: "50%",
                            border: "1.5px solid var(--color-border)",
                            flexShrink: 0,
                          }}
                        />
                      )}
                      {s}
                    </button>
                  );
                })}
              </div>

              {/* Footer buttons */}
              <div style={{ marginTop: "auto", paddingTop: 14, display: "flex", gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setPhase("upload")}
                  style={{
                    height: 46,
                    flex: 1,
                    border: "1.5px solid var(--color-border)",
                    color: "var(--color-ink-subtle)",
                    background: "var(--color-card)",
                    borderRadius: 999,
                    fontSize: 13,
                    fontWeight: 800,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => setPhase("confirm")}
                  style={{
                    height: 46,
                    flex: 2,
                    background: "var(--color-primary)",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: 999,
                    fontSize: 13,
                    fontWeight: 800,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Continue → confirm 1,237 users
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {phase === "confirm" ? (
          <div style={{ maxWidth: 560 }}>
            <div style={panelStyle}>
              <Eyebrow>Ready to start</Eyebrow>
              <div style={{ fontSize: 15, fontWeight: 800, marginTop: 8 }}>
                1,237 users → {scope}
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: "var(--color-ink-secondary)",
                  lineHeight: 1.6,
                  marginTop: 8,
                }}
              >
                File: <span style={{ fontFamily: MONO }}>SY2026_enrollment.csv</span> · 1,240 rows
                (3 set aside to fix later)
                <br />
                Target scope: Division of Cavite › Dasmariñas District › {scope}
                <br />
                New accounts start as pending activation — each gets an invite to set a password.
              </div>
              <p
                style={{
                  fontSize: 11.5,
                  color: "var(--color-ink-subtle)",
                  lineHeight: 1.5,
                  marginTop: 10,
                }}
              >
                The target scope is locked once the job starts and stays on the job record forever —
                recorded in the audit trail.
              </p>
              <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                <button
                  type="button"
                  onClick={() => setPhase("review")}
                  style={{
                    height: 46,
                    flex: 1,
                    border: "1.5px solid var(--color-border)",
                    color: "var(--color-ink-subtle)",
                    background: "var(--color-card)",
                    borderRadius: 999,
                    fontSize: 13,
                    fontWeight: 800,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => setPhase("started")}
                  style={{
                    height: 46,
                    flex: 2,
                    background: "var(--color-primary)",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: 999,
                    fontSize: 13,
                    fontWeight: 800,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Start import — 1,237 users
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {phase === "started" ? (
          /* 202 Accepted — the job id comes back instantly, never a spinner */
          <div style={{ maxWidth: 560 }}>
            <div
              style={{
                background: "var(--color-card)",
                border: "1.5px solid var(--color-success-border)",
                borderRadius: 14,
                padding: "18px 20px",
              }}
            >
              <Chip tone="synced" icon={<Icon name="check" size={13} strokeWidth={2.8} />}>
                Job started
              </Chip>
              <div style={{ fontSize: 15, fontWeight: 800, marginTop: 10 }}>
                Import #4127 is running in the background
              </div>
              <p
                style={{
                  fontSize: 12.5,
                  color: "var(--color-ink-subtle)",
                  lineHeight: 1.55,
                  marginTop: 6,
                }}
              >
                Started just now by D. Lopez · target: San Isidro NHS. You can leave this page — the
                import keeps running and you&rsquo;ll get a notification when it finishes.
              </p>
              <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center" }}>
                <Link
                  href="/admin/import/job"
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
                  View job progress →
                </Link>
                <button
                  type="button"
                  onClick={() => setPhase("upload")}
                  style={{
                    border: "none",
                    background: "none",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontSize: 13,
                    fontWeight: 700,
                    color: "var(--color-ink-subtle)",
                    padding: "0 8px",
                  }}
                >
                  Start another import
                </button>
              </div>
              <p
                style={{
                  fontSize: 11.5,
                  color: "var(--color-ink-subtle)",
                  lineHeight: 1.5,
                  marginTop: 12,
                  marginBottom: 0,
                }}
              >
                Starting an import returns a job number instantly — jobs are idempotent, so
                re-submitting the same file can&rsquo;t double-create users.
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </AdminShell>
  );
}
