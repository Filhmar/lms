"use client";

/**
 * p1g + d6a — Bulk CSV import wizard, wired to the 202 job pattern.
 *   1. Upload    — real file picker; the header row is checked INSTANTLY on
 *                  device (must equal `email,full_name,role,phone`) — a bad
 *                  file never leaves the browser.
 *   2. Choose scope — target scope from GET /scopes/:id/subtree.
 *   3. Confirm   — POST /provisioning/bulk-import (multipart file +
 *                  targetScopeId) → 202 { jobId } → the job screen.
 * Never a spinner; progress lives inside the button.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Dropzone, Icon } from "@rl/ui";
import type { BulkImportAccepted } from "@rl/schemas";
import { CSV_IMPORT_HEADER } from "@rl/schemas";
import { apiUpload, getErrorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { AdminChrome, AdminErrorBanner, ScopeSelect, useSubtree } from "../chrome";
import { Eyebrow, MONO } from "../ui";

const EXPECTED_HEADER = CSV_IMPORT_HEADER.join(",");

/* ------------------------------------------------------------------ */
/* Stepper — an ordered list with aria-current (per d6notes a11y).     */
/* ------------------------------------------------------------------ */

const STEPS = ["Upload", "Check file", "Choose scope", "Confirm"] as const;

function Stepper({ active }: { active: number /* 1-based; 5 = all done */ }) {
  return (
    <ol
      className="imp-steps"
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
                className="imp-conn"
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

interface CheckedFile {
  file: File;
  /** null = header OK; otherwise the actionable problems found. */
  problems: string[] | null;
  headerLine: string;
  dataRows: number;
  /** First 5 data rows (name/email/role) — the visual mapping check (cimp-a). */
  preview: { name: string; email: string; role: string }[];
}

async function checkFile(file: File): Promise<CheckedFile> {
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const headerLine = lines[0]?.trim() ?? "";
  const dataRows = Math.max(0, lines.length - 1);
  /* header order is fixed (email,full_name,role,phone) — naive split is
     fine for a preview; the job does the authoritative parse */
  const preview = lines.slice(1, 6).map((line) => {
    const cells = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    return { email: cells[0] ?? "", name: cells[1] ?? "", role: cells[2] ?? "" };
  });
  const problems: string[] = [];
  if (headerLine === "") {
    problems.push("The file is empty — no header row found.");
  } else if (headerLine.replace(/\s/g, "").toLowerCase() !== EXPECTED_HEADER) {
    const got = headerLine.split(",").map((c) => c.trim().toLowerCase());
    for (const col of CSV_IMPORT_HEADER) {
      if (!got.includes(col)) problems.push(`Missing column: ${col}`);
    }
    for (const col of got) {
      if (!(CSV_IMPORT_HEADER as readonly string[]).includes(col)) {
        problems.push(`Unexpected column: "${col}"`);
      }
    }
    if (problems.length === 0) problems.push("Columns are in the wrong order.");
  } else if (dataRows === 0) {
    problems.push("The header is right, but there are no data rows under it.");
  }
  return { file, problems: problems.length > 0 ? problems : null, headerLine, dataRows, preview };
}

export default function ImportWizardPage() {
  return (
    <AdminChrome title="Import users">
      <ImportWizardBody />
    </AdminChrome>
  );
}

function ImportWizardBody() {
  const router = useRouter();
  const { user } = useSession();
  const { scopes } = useSubtree(user?.scopeId ?? null);

  const [checked, setChecked] = useState<CheckedFile | null>(null);
  const [phase, setPhase] = useState<"upload" | "scope" | "confirm">("upload");
  const [targetScopeId, setTargetScopeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const targetScope = useMemo(
    () => scopes?.find((s) => s.id === (targetScopeId || user?.scopeId)) ?? null,
    [scopes, targetScopeId, user?.scopeId],
  );

  const fmt = (n: number) => n.toLocaleString("en-US");

  async function onPickFile(file: File | undefined) {
    if (!file) return;
    const result = await checkFile(file);
    setChecked(result);
    setSubmitError(null);
    if (!result.problems) setPhase("scope");
    else setPhase("upload");
  }

  async function startImport() {
    if (!checked || checked.problems || busy) return;
    const scopeId = targetScopeId || user?.scopeId;
    if (!scopeId) return;
    setBusy(true);
    setSubmitError(null);
    const form = new FormData();
    form.append("file", checked.file);
    form.append("targetScopeId", scopeId);
    try {
      const res = await apiUpload<BulkImportAccepted>("/provisioning/bulk-import", form);
      router.push(`/admin/import/job?id=${res.jobId}`);
    } catch (err) {
      setSubmitError(getErrorMessage(err));
      setBusy(false);
    }
  }

  const activeStep = phase === "upload" ? (checked?.problems ? 2 : 1) : phase === "scope" ? 3 : 4;

  return (
    <div style={{ padding: "20px 22px", minHeight: 480 }}>
      <style>{impCss}</style>
      <Stepper active={activeStep} />

      {phase === "upload" ? (
        <div
          className={checked?.problems ? "imp-two" : undefined}
          style={{
            display: "grid",
            gap: 12,
            maxWidth: checked?.problems ? undefined : 560,
          }}
        >
          {/* Dropzone — drag-drop AND click-to-browse (keyboard-openable) */}
          <div>
            <Dropzone
              accept=".csv,text/csv"
              onFile={(file) => void onPickFile(file)}
              title={
                <>
                  Drop CSV here or <strong style={{ color: "var(--color-primary)" }}>browse</strong>
                </>
              }
              meta="up to 50,000 rows"
            />
            <div
              style={{
                fontSize: 11.5,
                color: "var(--color-ink-subtle)",
                marginTop: 12,
                lineHeight: 1.6,
                textAlign: "center",
              }}
            >
              Needs exactly this header row:{" "}
              <span
                style={{
                  fontFamily: MONO,
                  background: "var(--color-canvas)",
                  padding: "2px 6px",
                  borderRadius: 5,
                }}
              >
                {EXPECTED_HEADER}
              </span>
              <br />
              The header is checked instantly on this computer — a bad file never starts a job.
            </div>
          </div>

          {/* Failed structure check — a bad file never creates a job */}
          {checked?.problems ? (
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
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{checked.file.name}</div>
                  <div className="rl-num" style={{ fontSize: 11.5, color: "var(--color-ink-subtle)" }}>
                    {fmt(checked.dataRows)} data row{checked.dataRows === 1 ? "" : "s"} · checked
                    instantly, before anything runs
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
                    fontFamily: MONO,
                  }}
                >
                  {checked.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
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
                Fix the header in your spreadsheet so the first row is exactly{" "}
                <span style={{ fontFamily: MONO }}>{EXPECTED_HEADER}</span>, then choose the file
                again. Nothing was created.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {phase === "scope" && checked && !checked.problems ? (
        <div className="imp-two" style={{ display: "grid", gap: 12 }}>
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
                <div style={{ fontSize: 14, fontWeight: 700 }}>{checked.file.name}</div>
                <div className="rl-num" style={{ fontSize: 11.5, color: "var(--color-ink-subtle)" }}>
                  {fmt(checked.dataRows)} data row{checked.dataRows === 1 ? "" : "s"} ·{" "}
                  {Math.max(1, Math.round(checked.file.size / 1024))} KB · header checked on this
                  computer
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setChecked(null);
                  setPhase("upload");
                }}
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

            <div
              style={{
                background: "#EEF9F1",
                border: "1px solid var(--color-success-border)",
                borderRadius: 10,
                padding: "10px 12px",
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
                  color: "var(--color-synced-fg)",
                }}
              >
                <Icon name="check" size={14} strokeWidth={2.8} />
                Header row is exactly right
              </div>
              <div style={{ fontSize: 11.5, color: "var(--color-ink-secondary)", marginTop: 4, fontFamily: MONO }}>
                {EXPECTED_HEADER}
              </div>
            </div>

            {/* FIRST 5 ROWS — the visual mapping check */}
            {checked.preview.length > 0 ? (
              <div style={{ marginTop: 13 }}>
                <Eyebrow style={{ letterSpacing: "0.07em" }}>First {checked.preview.length} rows</Eyebrow>
                <div
                  style={{
                    border: "1px solid var(--color-border)",
                    borderRadius: 10,
                    overflow: "hidden",
                    fontSize: 11.5,
                    marginTop: 7,
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1.4fr 0.8fr",
                      background: "var(--color-surface-muted)",
                      fontWeight: 800,
                      color: "var(--color-ink-subtle)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      fontSize: 10,
                      padding: "6px 10px",
                    }}
                  >
                    <span>Name</span>
                    <span>Email</span>
                    <span>Role</span>
                  </div>
                  {checked.preview.map((r, i) => (
                    <div
                      key={i}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1.4fr 0.8fr",
                        padding: "6px 10px",
                        borderTop: "1px solid var(--color-divider)",
                        alignItems: "center",
                      }}
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.name || "—"}
                      </span>
                      <span
                        style={{
                          color: "var(--color-ink-subtle)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {r.email || "—"}
                      </span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.role || "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <p
              style={{
                fontSize: 11.5,
                color: "var(--color-ink-subtle)",
                lineHeight: 1.5,
                marginTop: 10,
              }}
            >
              Row-by-row checks (emails, roles, phone numbers) run inside the job — rows that need a
              fix are listed on the job screen and never block the clean ones.
            </p>
          </div>

          {/* Panel B — scope picker */}
          <div style={{ ...panelStyle, display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 13, fontWeight: 800 }}>Where do these users belong?</div>
            <div style={{ fontSize: 11.5, color: "var(--color-ink-subtle)", marginTop: 2 }}>
              New accounts are created inside this scope only.
            </div>

            <div style={{ marginTop: 12 }}>
              <ScopeSelect
                label="Target scope"
                scopes={scopes}
                value={targetScopeId || user?.scopeId || ""}
                onChange={setTargetScopeId}
              />
            </div>

            <div style={{ marginTop: "auto", paddingTop: 14, display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={() => {
                  setChecked(null);
                  setPhase("upload");
                }}
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
                Continue → confirm {fmt(checked.dataRows)} rows
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {phase === "confirm" && checked && !checked.problems ? (
        <div style={{ maxWidth: 560 }}>
          <div style={panelStyle}>
            <Eyebrow>Ready to start</Eyebrow>
            <div style={{ fontSize: 15, fontWeight: 800, marginTop: 8 }}>
              {fmt(checked.dataRows)} rows → {targetScope?.name ?? "your scope"}
            </div>
            <div
              style={{
                fontSize: 12.5,
                color: "var(--color-ink-secondary)",
                lineHeight: 1.6,
                marginTop: 8,
              }}
            >
              File: <span style={{ fontFamily: MONO }}>{checked.file.name}</span> ·{" "}
              {fmt(checked.dataRows)} data rows
              <br />
              Target scope: {targetScope?.name ?? "your scope"}
              <br />
              New accounts start as pending activation — each person activates with a texted code.
            </div>
            <p
              style={{
                fontSize: 11.5,
                color: "var(--color-ink-subtle)",
                lineHeight: 1.5,
                marginTop: 10,
              }}
            >
              Starting the import returns a job number instantly (202) — you can leave the page and
              the job keeps running.
            </p>
            {submitError ? (
              <div style={{ marginTop: 10 }}>
                <AdminErrorBanner>{submitError}</AdminErrorBanner>
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <button
                type="button"
                onClick={() => setPhase("scope")}
                disabled={busy}
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
                onClick={() => void startImport()}
                disabled={busy}
                style={{
                  height: 46,
                  flex: 2,
                  background: "var(--color-primary)",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: 800,
                  cursor: busy ? "default" : "pointer",
                  fontFamily: "inherit",
                  opacity: busy ? 0.7 : 1,
                }}
              >
                {busy ? "Starting the job…" : `Start import — ${fmt(checked.dataRows)} rows`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* Desktop layout as designed; phones (<720px) wrap the stepper (its
   connector lines drop out) and stack the two-pane grids. */
const impCss = `
.imp-two{grid-template-columns:1fr 1fr;}
@media (max-width:719px){
  .imp-steps{flex-wrap:wrap;row-gap:8px;}
  .imp-conn{display:none;}
  .imp-steps li{margin-right:14px;}
  .imp-two{grid-template-columns:1fr;}
}
`;
