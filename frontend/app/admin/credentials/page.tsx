"use client";

/**
 * p4e — Admin credential console, REAL:
 *   · GET  /credentials/admin?scopeId=&page=   (oversight over the subtree;
 *     holder names visible — masking is for the public portal only)
 *   · POST /credentials/:id/revoke  { reason }  (reason required, audited)
 *   · POST /credentials/:id/restore             (reversible, audited)
 * Revocation propagates to the public verify page within a minute. The
 * audit-trail panel shows this session's actions — the API exposes no audit
 * read yet; the registry keeps the authoritative trail server-side.
 */

import { useEffect, useState } from "react";
import { Toast } from "@rl/ui";
import type { CredentialListItem } from "@rl/schemas";
import { apiGet, apiPost, getErrorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import {
  AdminChrome,
  AdminErrorBanner,
  ScopeSelect,
  useSubtree,
} from "../chrome";
import { Eyebrow, MONO } from "../ui";

/** Server shape — list item + holder identity + revocation detail. */
interface AdminCredentialItem extends CredentialListItem {
  holderName: string;
  userId: string;
  issuedScopeId: string;
  revokedReason: string | null;
}

interface AdminListResponse {
  items: AdminCredentialItem[];
  total: number;
  page: number;
  pageSize: number;
}

interface AuditEntry {
  when: string;
  text: string;
}

const statusChipStyle = (status: CredentialListItem["status"]): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  borderRadius: 999,
  padding: "3px 9px",
  fontSize: 10.5,
  fontWeight: 700,
  ...(status === "active"
    ? { background: "var(--color-synced-bg)", color: "var(--color-synced-fg)" }
    : { background: "var(--color-attention-bg)", color: "var(--color-attention-fg)" }),
});

const COLUMNS = "1.15fr 1.3fr 1.1fr 1fr 0.7fr 0.75fr";

const fmtWhen = (d: Date) =>
  `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${d.toLocaleTimeString(
    "en-US",
    { hour: "numeric", minute: "2-digit" },
  )}`;

export default function CredentialConsolePage() {
  return (
    <AdminChrome title="Credentials">
      <CredentialConsoleBody />
    </AdminChrome>
  );
}

function CredentialConsoleBody() {
  const { user } = useSession();
  const rootId = user?.scopeId ?? null;
  const { scopes } = useSubtree(rootId);

  const [scopeId, setScopeId] = useState<string>("");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [list, setList] = useState<AdminListResponse | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const [query, setQuery] = useState("");
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [dialog, setDialog] = useState<{
    item: AdminCredentialItem;
    mode: "revoke" | "restore";
  } | null>(null);
  const [reason, setReason] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!rootId) return;
    let cancelled = false;
    setListError(null);
    const params = new URLSearchParams();
    params.set("scopeId", scopeId || rootId);
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    apiGet<AdminListResponse>(`/credentials/admin?${params.toString()}`)
      .then((res) => {
        if (!cancelled) setList(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setListError(getErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [rootId, scopeId, page, nonce]);

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 3600);
  }

  function applyUpdated(updated: AdminCredentialItem) {
    setList((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.map((i) => (i.id === updated.id ? updated : i)),
          }
        : prev,
    );
  }

  async function confirmDialog() {
    if (!dialog || busy) return;
    const actor = user ? user.fullName : "you";
    setBusy(true);
    setDialogError(null);
    try {
      if (dialog.mode === "revoke") {
        const trimmed = reason.trim();
        if (!trimmed) return;
        const updated = await apiPost<AdminCredentialItem>(
          `/credentials/${dialog.item.id}/revoke`,
          { reason: trimmed },
        );
        applyUpdated(updated);
        setAudit((a) => [
          {
            when: fmtWhen(new Date()),
            text: `Revoked ${updated.controlNo} by ${actor} — "${trimmed}"`,
          },
          ...a,
        ]);
        showToast("Revoked — the public page shows REVOKED within a minute.");
      } else {
        const updated = await apiPost<AdminCredentialItem>(
          `/credentials/${dialog.item.id}/restore`,
        );
        applyUpdated(updated);
        setAudit((a) => [
          { when: fmtWhen(new Date()), text: `Restored ${updated.controlNo} by ${actor}` },
          ...a,
        ]);
        showToast("Restored — the public page shows VERIFIED within a minute.");
      }
      setDialog(null);
    } catch (err) {
      setDialogError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!user) return null;

  const q = query.trim().toLowerCase();
  const rows = (list?.items ?? []).filter(
    (r) =>
      !q ||
      r.controlNo.toLowerCase().includes(q) ||
      r.title.toLowerCase().includes(q) ||
      r.holderName.toLowerCase().includes(q) ||
      r.issuerLine.toLowerCase().includes(q),
  );

  const total = list?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div style={{ padding: "20px 22px", minHeight: 430 }}>
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 12,
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 240, flex: "0 1 300px" }}>
          <ScopeSelect
            label="Scope (includes everything below it)"
            scopes={scopes}
            value={scopeId || rootId || ""}
            onChange={(id) => {
              setScopeId(id);
              setPage(1);
            }}
          />
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search control no., holder, or credential…"
          aria-label="Search control no., holder, or credential"
          style={{
            marginLeft: "auto",
            height: 44,
            border: "1.5px solid var(--color-border)",
            borderRadius: 999,
            padding: "0 14px",
            fontSize: 12,
            background: "var(--color-card)",
            color: "var(--color-ink)",
            width: 260,
            fontFamily: "inherit",
          }}
        />
      </div>

      {listError ? (
        <div style={{ marginBottom: 12 }}>
          <AdminErrorBanner>{listError}</AdminErrorBanner>
        </div>
      ) : null}

      {/* Main grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 12 }}>
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
            <span>Holder</span>
            <span>School</span>
            <span>Status</span>
            <span />
          </div>
          {!list && !listError ? (
            <div style={{ padding: "14px 16px", fontSize: 12.5, color: "var(--color-ink-subtle)" }}>
              Loading credentials in your scope…
            </div>
          ) : null}
          {rows.map((r, i) => (
            <div
              key={r.id}
              style={{
                display: "grid",
                gridTemplateColumns: COLUMNS,
                alignItems: "center",
                padding: "11px 16px",
                fontSize: 12.5,
                borderBottom: i === rows.length - 1 ? "none" : "1px solid var(--color-divider)",
                background: r.status === "revoked" ? "var(--color-danger-surface)" : undefined,
              }}
            >
              <span className="rl-num" style={{ fontFamily: MONO, fontSize: 11.5 }}>
                {r.controlNo}
              </span>
              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    display: "block",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {r.title}
                </span>
                <span style={{ fontSize: 10.5, color: "var(--color-ink-faint)" }}>
                  {r.kind === "certificate" ? "Certificate" : "Badge"}
                </span>
              </span>
              <span
                style={{
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={r.holderName}
              >
                {r.holderName}
              </span>
              <span
                style={{
                  color: "var(--color-ink-subtle)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={r.issuerLine}
              >
                {r.issuerLine.split(", ")[0]}
              </span>
              <span>
                <span
                  style={statusChipStyle(r.status)}
                  title={r.status === "revoked" && r.revokedReason ? r.revokedReason : undefined}
                >
                  {r.status === "active" ? "Active" : "Revoked"}
                </span>
              </span>
              <span style={{ textAlign: "right" }}>
                {r.status === "active" ? (
                  <button
                    type="button"
                    onClick={() => {
                      setDialog({ item: r, mode: "revoke" });
                      setReason("");
                      setDialogError(null);
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
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setDialog({ item: r, mode: "restore" });
                      setDialogError(null);
                    }}
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
                )}
              </span>
            </div>
          ))}
          {list && rows.length === 0 ? (
            <div style={{ padding: "14px 16px", fontSize: 12.5, color: "var(--color-ink-subtle)" }}>
              {q
                ? "No credentials match — search covers this page of your scope."
                : "No credentials issued in this scope yet."}
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
                  ? `Revoke ${dialog.item.controlNo}?`
                  : `Restore ${dialog.item.controlNo}?`
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
                  {dialog.item.controlNo}
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
                    &ldquo;{dialog.item.title}&rdquo; held by <b>{dialog.item.holderName}</b>. The
                    public page will show <strong>REVOKED</strong> within a minute. This is
                    recorded and reversible.
                  </>
                ) : (
                  <>
                    &ldquo;{dialog.item.title}&rdquo; held by <b>{dialog.item.holderName}</b>. The
                    public page will show <strong>VERIFIED</strong> again within a minute. The
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
                    placeholder="e.g. Issued against the wrong learner record."
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
              {dialogError ? (
                <div style={{ marginTop: 10 }}>
                  <AdminErrorBanner>{dialogError}</AdminErrorBanner>
                </div>
              ) : null}
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  onClick={() => setDialog(null)}
                  disabled={busy}
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
                  onClick={() => void confirmDialog()}
                  disabled={busy || (dialog.mode === "revoke" && !reason.trim())}
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
                      busy || (dialog.mode === "revoke" && !reason.trim())
                        ? "not-allowed"
                        : "pointer",
                    fontFamily: "inherit",
                    opacity: busy ? 0.7 : 1,
                  }}
                >
                  {dialog.mode === "revoke"
                    ? busy
                      ? "Revoking…"
                      : "Revoke credential"
                    : busy
                      ? "Restoring…"
                      : "Restore credential"}
                </button>
              </div>
            </div>
          ) : null}

          {/* Audit trail — this session's actions (the registry keeps the
              authoritative server-side trail; no read API yet). */}
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
              {audit.length === 0 ? (
                <div style={{ fontSize: 11.5, color: "var(--color-ink-faint)", lineHeight: 1.5 }}>
                  Actions you take here appear in this list.
                </div>
              ) : (
                audit.map((entry, i) => (
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
                ))
              )}
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
              Every revoke and restore is recorded in the registry with its reason. Proof
              survives even if the source course is deleted.
            </p>
          </div>

          {/* Pagination */}
          {list && lastPage > 1 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                style={{
                  height: 34,
                  padding: "0 13px",
                  borderRadius: 999,
                  border: "1.5px solid var(--color-border)",
                  background: "var(--color-card)",
                  color: page <= 1 ? "var(--color-ink-faint)" : "var(--color-ink-secondary)",
                  fontSize: 11.5,
                  fontWeight: 800,
                  cursor: page <= 1 ? "default" : "pointer",
                  fontFamily: "inherit",
                }}
              >
                ← Previous
              </button>
              <span className="rl-num" style={{ fontWeight: 700 }}>
                Page {page} of {lastPage}
              </span>
              <button
                type="button"
                disabled={page >= lastPage}
                onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
                style={{
                  height: 34,
                  padding: "0 13px",
                  borderRadius: 999,
                  border: "1.5px solid var(--color-border)",
                  background: "var(--color-card)",
                  color:
                    page >= lastPage ? "var(--color-ink-faint)" : "var(--color-ink-secondary)",
                  fontSize: 11.5,
                  fontWeight: 800,
                  cursor: page >= lastPage ? "default" : "pointer",
                  fontFamily: "inherit",
                }}
              >
                Next →
              </button>
            </div>
          ) : null}
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
    </div>
  );
}
