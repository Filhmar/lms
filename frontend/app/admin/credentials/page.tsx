"use client";

/**
 * p4e — Admin credential console. Issuance oversight, revocation with a
 * confirmation dialog (reason required, kept in audit) and a visible
 * audit trail. Revocation propagates to the public page within a minute
 * and is reversible; "Pending send" credentials are not actionable until
 * the school's confirmation arrives.
 */

import { useState } from "react";
import { ScopeBreadcrumb, Toast } from "@rl/ui";
import { AdminShell, Eyebrow, MONO } from "../ui";

type Status = "Active" | "Revoked" | "Pending send";

interface CredentialRow {
  controlNo: string;
  credential: string;
  school: string;
}

const ROWS: CredentialRow[] = [
  { controlNo: "2026-04-118203", credential: "Grade 7 Completion", school: "San Isidro NHS" },
  { controlNo: "2026-04-102117", credential: "Science Star badge", school: "Salawag IS" },
  { controlNo: "2026-04-097761", credential: "Grade 7 Completion", school: "Dasmariñas East ES" },
];

interface AuditEntry {
  when: string;
  text: string;
}

const INITIAL_AUDIT: AuditEntry[] = [
  { when: "Jul 6, 10:18", text: "Viewed by D. Lopez (Division)" },
  { when: "Mar 28, 16:02", text: "Issued by San Isidro NHS · batch #88" },
  { when: "Mar 28, 16:02", text: "QR generated · control no. assigned" },
];

const statusChipStyle = (status: Status): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  borderRadius: 999,
  padding: "3px 9px",
  fontSize: 10.5,
  fontWeight: 700,
  ...(status === "Active"
    ? { background: "var(--color-synced-bg)", color: "var(--color-synced-fg)" }
    : status === "Revoked"
      ? { background: "var(--color-attention-bg)", color: "var(--color-attention-fg)" }
      : { background: "var(--color-on-device-bg)", color: "var(--color-on-device-fg)" }),
});

const COLUMNS = "1.4fr 1.2fr 1fr 0.9fr 0.9fr";

export default function CredentialConsolePage() {
  const [statuses, setStatuses] = useState<Record<string, Status>>({
    "2026-04-118203": "Active",
    "2026-04-102117": "Revoked",
    "2026-04-097761": "Pending send",
  });
  const [audit, setAudit] = useState<AuditEntry[]>(INITIAL_AUDIT);
  const [dialog, setDialog] = useState<{ controlNo: string; mode: "revoke" | "restore" } | null>(
    null,
  );
  const [reason, setReason] = useState("Issued against the wrong learner record.");
  const [toast, setToast] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 3200);
  }

  function confirmDialog() {
    if (!dialog) return;
    if (dialog.mode === "revoke") {
      if (!reason.trim()) return;
      setStatuses((s) => ({ ...s, [dialog.controlNo]: "Revoked" }));
      setAudit((a) => [
        { when: "Jul 6, 10:52", text: `Revoked by D. Lopez (Division) — "${reason.trim()}"` },
        ...a,
      ]);
      showToast("Revoked — the public page shows REVOKED within a minute.");
    } else {
      setStatuses((s) => ({ ...s, [dialog.controlNo]: "Active" }));
      setAudit((a) => [
        { when: "Jul 6, 10:52", text: "Restored by D. Lopez (Division)" },
        ...a,
      ]);
      showToast("Restored — the public page shows VERIFIED within a minute.");
    }
    setDialog(null);
  }

  const q = query.trim().toLowerCase();
  const rows = ROWS.filter(
    (r) => !q || r.controlNo.includes(q) || r.school.toLowerCase().includes(q),
  );

  return (
    <AdminShell>
      <div style={{ padding: "20px 22px", minHeight: 430 }}>
        {/* Header row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 14,
            flexWrap: "wrap",
          }}
        >
          <h1 style={{ fontSize: 17, fontWeight: 800, flexShrink: 0 }}>Credentials</h1>
          <ScopeBreadcrumb
            ancestors={["Central", "Region IV-A"]}
            current="Division of Cavite"
            note="Your scope"
            style={{
              background: "var(--color-card)",
              borderRadius: 999,
              padding: "6px 12px",
              fontSize: 12,
            }}
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search control no. or school…"
            aria-label="Search control no. or school"
            style={{
              marginLeft: "auto",
              height: 38,
              border: "1.5px solid var(--color-border)",
              borderRadius: 999,
              padding: "0 14px",
              fontSize: 12,
              background: "var(--color-card)",
              color: "var(--color-ink)",
              width: 220,
              fontFamily: "inherit",
            }}
          />
        </div>

        {/* Main grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 12 }}>
          {/* Credentials table */}
          <div
            style={{
              background: "var(--color-card)",
              border: "1px solid var(--color-border)",
              borderRadius: 14,
              overflow: "hidden",
              alignSelf: "start",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: COLUMNS,
                padding: "10px 16px",
                fontSize: 10.5,
                fontWeight: 800,
                letterSpacing: "0.06em",
                color: "var(--color-ink-subtle)",
                borderBottom: "1.5px solid var(--color-border)",
                textTransform: "uppercase",
              }}
            >
              <span>Control no.</span>
              <span>Credential</span>
              <span>School</span>
              <span>Status</span>
              <span />
            </div>
            {rows.map((r, i) => {
              const status = statuses[r.controlNo] ?? "Active";
              return (
                <div
                  key={r.controlNo}
                  style={{
                    display: "grid",
                    gridTemplateColumns: COLUMNS,
                    alignItems: "center",
                    padding: "11px 16px",
                    fontSize: 12.5,
                    borderBottom: i === rows.length - 1 ? "none" : "1px solid var(--color-divider)",
                    background: status === "Revoked" ? "var(--color-danger-surface)" : undefined,
                  }}
                >
                  <span className="rl-num" style={{ fontFamily: MONO, fontSize: 11.5 }}>
                    {r.controlNo}
                  </span>
                  <span>{r.credential}</span>
                  <span style={{ color: "var(--color-ink-subtle)" }}>{r.school}</span>
                  <span>
                    <span style={statusChipStyle(status)}>{status}</span>
                  </span>
                  <span style={{ textAlign: "right" }}>
                    {status === "Active" ? (
                      <button
                        type="button"
                        onClick={() => {
                          setDialog({ controlNo: r.controlNo, mode: "revoke" });
                          setReason("Issued against the wrong learner record.");
                        }}
                        style={{
                          border: "none",
                          background: "none",
                          cursor: "pointer",
                          fontFamily: "inherit",
                          fontSize: 11.5,
                          fontWeight: 700,
                          color: "var(--color-attention-fg)",
                          padding: 0,
                        }}
                      >
                        Revoke…
                      </button>
                    ) : status === "Revoked" ? (
                      <button
                        type="button"
                        onClick={() => setDialog({ controlNo: r.controlNo, mode: "restore" })}
                        style={{
                          border: "none",
                          background: "none",
                          cursor: "pointer",
                          fontFamily: "inherit",
                          fontSize: 11.5,
                          fontWeight: 700,
                          color: "var(--color-primary)",
                          padding: 0,
                        }}
                      >
                        Restore…
                      </button>
                    ) : (
                      <span
                        title="Earned on a device, not yet confirmed by the school — no action until it arrives"
                        style={{ fontSize: 11.5, color: "var(--color-ink-faint)" }}
                      >
                        —
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
            {rows.length === 0 ? (
              <div style={{ padding: "14px 16px", fontSize: 12.5, color: "var(--color-ink-subtle)" }}>
                No credentials match — search covers your division only.
              </div>
            ) : null}
          </div>

          {/* Right column */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {dialog ? (
              <div
                role="dialog"
                aria-label={
                  dialog.mode === "revoke"
                    ? `Revoke ${dialog.controlNo}?`
                    : `Restore ${dialog.controlNo}?`
                }
                style={{
                  background: "var(--color-card)",
                  border: `2px solid ${
                    dialog.mode === "revoke" ? "var(--color-destructive)" : "var(--color-primary)"
                  }`,
                  borderRadius: 14,
                  padding: 16,
                }}
              >
                <div
                  style={{
                    fontSize: 13.5,
                    fontWeight: 800,
                    color:
                      dialog.mode === "revoke"
                        ? "var(--color-attention-fg)"
                        : "var(--color-primary)",
                  }}
                >
                  {dialog.mode === "revoke" ? "Revoke" : "Restore"}{" "}
                  <span className="rl-num" style={{ fontFamily: MONO }}>
                    {dialog.controlNo}
                  </span>
                  ?
                </div>
                <p
                  style={{
                    fontSize: 12,
                    color: "var(--color-ink-secondary)",
                    lineHeight: 1.55,
                    marginTop: 6,
                  }}
                >
                  {dialog.mode === "revoke" ? (
                    <>
                      The public page will show <strong>REVOKED</strong> within a minute. The
                      student and school head are notified. This is recorded and reversible.
                    </>
                  ) : (
                    <>
                      The public page will show <strong>VERIFIED</strong> again within a minute. The
                      restore is recorded in the audit trail.
                    </>
                  )}
                </p>
                {dialog.mode === "revoke" ? (
                  <div style={{ marginTop: 10 }}>
                    <label
                      htmlFor="revoke-reason"
                      style={{ display: "block", fontSize: 11, fontWeight: 700, marginBottom: 4 }}
                    >
                      Reason (required, kept in audit)
                    </label>
                    <textarea
                      id="revoke-reason"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      style={{
                        width: "100%",
                        minHeight: 40,
                        border: "1.5px solid var(--color-border)",
                        borderRadius: 10,
                        padding: "8px 11px",
                        fontSize: 12,
                        color: "var(--color-ink-secondary)",
                        fontFamily: "inherit",
                        background: "var(--color-card)",
                        resize: "vertical",
                      }}
                    />
                  </div>
                ) : null}
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button
                    type="button"
                    onClick={() => setDialog(null)}
                    style={{
                      flex: 1,
                      height: 40,
                      border: "1.5px solid var(--color-border)",
                      color: "var(--color-ink-subtle)",
                      background: "var(--color-card)",
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 800,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmDialog}
                    disabled={dialog.mode === "revoke" && !reason.trim()}
                    style={{
                      flex: 1,
                      height: 40,
                      border: "none",
                      background:
                        dialog.mode === "revoke" && !reason.trim()
                          ? "var(--color-disabled-bg)"
                          : dialog.mode === "revoke"
                            ? "var(--color-destructive)"
                            : "var(--color-primary)",
                      color:
                        dialog.mode === "revoke" && !reason.trim()
                          ? "var(--color-disabled-fg)"
                          : "#ffffff",
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 800,
                      cursor:
                        dialog.mode === "revoke" && !reason.trim() ? "not-allowed" : "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {dialog.mode === "revoke" ? "Revoke credential" : "Restore credential"}
                  </button>
                </div>
              </div>
            ) : null}

            {/* Audit trail */}
            <div
              style={{
                background: "var(--color-card)",
                border: "1px solid var(--color-border)",
                borderRadius: 14,
                padding: "14px 16px",
              }}
            >
              <Eyebrow style={{ fontSize: 11 }}>Audit trail</Eyebrow>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 9 }}>
                {audit.map((entry, i) => (
                  <div
                    key={`${entry.when}-${i}`}
                    style={{
                      fontSize: 11.5,
                      color: "var(--color-ink-secondary)",
                      display: "flex",
                      gap: 8,
                      lineHeight: 1.45,
                    }}
                  >
                    <span
                      className="rl-num"
                      style={{ color: "var(--color-ink-faint)", flexShrink: 0 }}
                    >
                      {entry.when}
                    </span>
                    <span>{entry.text}</span>
                  </div>
                ))}
              </div>
              <p
                style={{
                  fontSize: 10.5,
                  color: "var(--color-ink-faint)",
                  marginTop: 10,
                  marginBottom: 0,
                  lineHeight: 1.5,
                }}
              >
                Every read and write is recorded — including views. Proof survives even if the
                source course is deleted.
              </p>
            </div>
          </div>
        </div>
      </div>

      {toast ? (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
            zIndex: 60,
          }}
        >
          <Toast>{toast}</Toast>
        </div>
      ) : null}
    </AdminShell>
  );
}
