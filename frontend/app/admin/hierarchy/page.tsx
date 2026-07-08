"use client";

/**
 * p1f + d7a–d7c — Hierarchy console, wired to the live API.
 *   · GET /scopes/:id/subtree   (the admin's whole visible tree)
 *   · GET /scopes/:id/stats     (selected-scope counts)
 *   · GET /scopes/:id/breadcrumb(selected-scope path)
 *   · POST /scopes              (create a child scope, invariants surfaced)
 * The subtree payload is the flat closure list (scope + depth, no parent
 * links), so the left rail groups scopes BY LEVEL rather than as a nested
 * tree — a documented limitation until parent linkage ships. Ancestors
 * above the admin's scope render grayed with a padlock (orientation only);
 * any 403 renders the designed scope wall.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Chip, Icon } from "@rl/ui";
import type {
  BreadcrumbResponse,
  CreateScopeRequest,
  Scope,
  ScopeLevel,
  ScopeStatsResponse,
  ScopeWithDepth,
  SubtreeResponse,
} from "@rl/schemas";
import { ScopeLevels } from "@rl/schemas";
import { ApiError, apiGet, apiPost, getErrorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { AdminChrome, AdminErrorBanner, LEVEL_LABEL, ScopeWall, useSubtree } from "../chrome";
import { Eyebrow } from "../ui";

const fmt = (n: number) => n.toLocaleString("en-US");

function childLevelOf(level: ScopeLevel): ScopeLevel | null {
  const i = ScopeLevels.indexOf(level);
  return i >= 0 && i < ScopeLevels.length - 1 ? ScopeLevels[i + 1]! : null;
}

const treeRowBase: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  padding: "8px 10px",
  borderRadius: 9,
  fontSize: 13,
  fontWeight: 600,
  width: "100%",
  textAlign: "left",
  border: "none",
  background: "none",
  fontFamily: "inherit",
};

function LockedTreeRow({ children }: { children: string }) {
  return (
    <div style={{ ...treeRowBase, paddingLeft: 10, color: "var(--color-ink-faint)" }}>
      <Icon name="lock" size={11} />
      {children}
    </div>
  );
}

interface ScopeDetail {
  stats: ScopeStatsResponse | null;
  children: ScopeWithDepth[];
  path: ScopeWithDepth[];
}

export default function HierarchyPage() {
  const [query, setQuery] = useState("");
  return (
    <AdminChrome
      title="Hierarchy"
      note="Your scope — you can't see sibling scopes"
      barExtra={
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search within your scope…"
          aria-label="Search within your scope"
          style={{
            height: 40,
            border: "1.5px solid var(--color-border)",
            borderRadius: 999,
            padding: "0 15px",
            fontSize: 12.5,
            background: "var(--color-card)",
            color: "var(--color-ink)",
            width: 230,
            fontFamily: "inherit",
          }}
        />
      }
    >
      <HierarchyBody query={query} />
    </AdminChrome>
  );
}

function HierarchyBody({ query }: { query: string }) {
  const { user, breadcrumb } = useSession();
  const rootId = user?.scopeId ?? null;
  const { scopes, error: subtreeError, reload: reloadSubtree } = useSubtree(rootId);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const effectiveSelected = selectedId ?? rootId;

  /* ------- selected-scope detail: stats + children + path, in parallel ------- */
  const [detail, setDetail] = useState<ScopeDetail | null>(null);
  const [detailError, setDetailError] = useState<ApiError | null>(null);
  const [detailNonce, setDetailNonce] = useState(0);

  useEffect(() => {
    if (!effectiveSelected) return;
    let cancelled = false;
    setDetail(null);
    setDetailError(null);
    Promise.all([
      apiGet<ScopeStatsResponse>(`/scopes/${effectiveSelected}/stats`).catch((err: unknown) => {
        // Stats endpoint failing alone shouldn't wall the page — surface null.
        if (err instanceof ApiError && err.status === 403) throw err;
        return null;
      }),
      apiGet<SubtreeResponse>(`/scopes/${effectiveSelected}/subtree`),
      apiGet<BreadcrumbResponse>(`/scopes/${effectiveSelected}/breadcrumb`).catch(() => null),
    ])
      .then(([stats, subtree, crumb]) => {
        if (cancelled) return;
        setDetail({
          stats,
          children: subtree.scopes.filter((s) => s.depth === 1).sort((a, b) => a.name.localeCompare(b.name)),
          path: crumb?.chain ?? [],
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDetailError(err instanceof ApiError ? err : new ApiError(0, "No connection right now."));
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveSelected, detailNonce]);

  /* ----------------------------- create dialog ----------------------------- */
  const [createOpen, setCreateOpen] = useState(false);

  const selectedScope: Scope | null = useMemo(() => {
    if (!scopes || !effectiveSelected) return null;
    return scopes.find((s) => s.id === effectiveSelected) ?? null;
  }, [scopes, effectiveSelected]);

  /* ------------------------------- left rail ------------------------------- */
  const q = query.trim().toLowerCase();
  const grouped = useMemo(() => {
    if (!scopes) return [];
    const filtered = q ? scopes.filter((s) => s.name.toLowerCase().includes(q)) : scopes;
    return ScopeLevels.map((level) => ({
      level,
      items: filtered
        .filter((s) => s.level === level && s.depth > 0)
        .sort((a, b) => a.name.localeCompare(b.name)),
    })).filter((g) => g.items.length > 0);
  }, [scopes, q]);
  const matchCount = q ? grouped.reduce((n, g) => n + g.items.length, 0) : 0;

  if (!user) return null;

  /* A 403 on the root subtree means the deep link points outside the scope. */
  if (subtreeError && subtreeError.status === 403) {
    return <ScopeWall message={subtreeError.message} />;
  }

  const rootMatchesQuery = !q || user.scopeName.toLowerCase().includes(q);
  const lockedAncestors = (breadcrumb ?? []).slice(0, -1);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr" }}>
      {/* ---------------- Left rail — your visible scopes ---------------- */}
      <div
        style={{
          borderRight: "1px solid var(--color-border)",
          padding: "16px 14px",
          background: "var(--color-card)",
          minHeight: 520,
        }}
      >
        <Eyebrow style={{ marginBottom: 10 }}>Your scopes</Eyebrow>

        {subtreeError && subtreeError.status !== 403 ? (
          <AdminErrorBanner>
            {subtreeError.message}{" "}
            <button
              type="button"
              onClick={reloadSubtree}
              style={{
                border: "none",
                background: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 12,
                fontWeight: 800,
                color: "var(--color-primary)",
                padding: 0,
              }}
            >
              Try again
            </button>
          </AdminErrorBanner>
        ) : null}

        {q ? (
          <div style={{ fontSize: 11.5, color: "var(--color-ink-subtle)", padding: "0 4px 8px" }}>
            {matchCount + (rootMatchesQuery ? 1 : 0)} match
            {matchCount + (rootMatchesQuery ? 1 : 0) === 1 ? "" : "es"} in your scope
          </div>
        ) : null}

        {/* Grayed ancestors — orientation only, never clickable */}
        {lockedAncestors.map((s) => (
          <LockedTreeRow key={s.id}>{`${s.name} · ${LEVEL_LABEL[s.level]}`}</LockedTreeRow>
        ))}

        {/* The admin's own scope */}
        {rootMatchesQuery ? (
          <button
            type="button"
            onClick={() => setSelectedId(rootId)}
            style={{
              ...treeRowBase,
              cursor: "pointer",
              background: effectiveSelected === rootId ? "var(--color-primary-tint)" : "none",
              color: effectiveSelected === rootId ? "var(--color-primary)" : "var(--color-ink-secondary)",
            }}
          >
            <span style={{ flex: 1 }}>{user.scopeName}</span>
            <span style={{ fontSize: 10.5, color: "var(--color-ink-faint)" }}>· you</span>
          </button>
        ) : null}

        {/* Descendants grouped by level (flat closure list — no parent links) */}
        {!scopes && !subtreeError ? (
          <div style={{ fontSize: 12, color: "var(--color-ink-subtle)", padding: "8px 4px" }}>
            Loading your scopes…
          </div>
        ) : null}
        {scopes && grouped.length === 0 && q && !rootMatchesQuery ? (
          <p style={{ fontSize: 12, color: "var(--color-ink-subtle)", lineHeight: 1.55, padding: "8px 4px" }}>
            No matches inside {user.scopeName}. Results never include sibling scopes.
          </p>
        ) : null}
        {grouped.map((g) => (
          <div key={g.level} style={{ marginTop: 8 }}>
            <Eyebrow spacing="0.06em" style={{ padding: "0 10px 4px" }}>
              {LEVEL_LABEL[g.level]}s · {fmt(g.items.length)}
            </Eyebrow>
            {g.items.map((s) => {
              const selected = s.id === effectiveSelected;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedId(s.id)}
                  style={{
                    ...treeRowBase,
                    paddingLeft: 22,
                    cursor: "pointer",
                    background: selected ? "var(--color-primary-tint)" : "none",
                    color: selected ? "var(--color-primary)" : "var(--color-ink-secondary)",
                  }}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
        ))}

        {/* Scope callout */}
        <div
          style={{
            marginTop: 14,
            background: "var(--color-canvas)",
            borderRadius: 10,
            padding: "10px 12px",
            fontSize: 11.5,
            lineHeight: 1.5,
            color: "var(--color-ink-subtle)",
          }}
        >
          <strong style={{ color: "var(--color-ink-secondary)" }}>
            Grayed levels are above your scope.
          </strong>{" "}
          Sibling scopes are never visible from here. Scopes are grouped by level — the subtree
          payload carries no parent links yet, so a nested tree isn&rsquo;t drawn.
        </div>
      </div>

      {/* ---------------- Right pane — selected scope detail ---------------- */}
      <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
        {detailError?.status === 403 ? (
          <ScopeWall message={detailError.message} onBack={() => setSelectedId(rootId)} />
        ) : detailError ? (
          <AdminErrorBanner>
            {detailError.message}{" "}
            <button
              type="button"
              onClick={() => setDetailNonce((n) => n + 1)}
              style={{
                border: "none",
                background: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 12,
                fontWeight: 800,
                color: "var(--color-primary)",
                padding: 0,
              }}
            >
              Try again
            </button>
          </AdminErrorBanner>
        ) : selectedScope || effectiveSelected === rootId ? (
          <ScopeDetailPane
            scope={
              selectedScope ?? {
                id: user.scopeId,
                name: user.scopeName,
                level: user.scopeLevel,
                createdAt: "",
              }
            }
            isOwnScope={effectiveSelected === rootId}
            detail={detail}
            onPick={(id) => setSelectedId(id)}
            onCreate={() => setCreateOpen(true)}
          />
        ) : null}
      </div>

      {/* Create-scope dialog */}
      {createOpen && selectedScopeOrRoot(user, selectedScope) ? (
        <CreateScopeDialog
          parent={selectedScopeOrRoot(user, selectedScope)!}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            reloadSubtree();
            setDetailNonce((n) => n + 1);
          }}
        />
      ) : null}
    </div>
  );
}

function selectedScopeOrRoot(
  user: { scopeId: string; scopeName: string; scopeLevel: ScopeLevel },
  selected: Scope | null,
): Scope | null {
  if (selected) return selected;
  return { id: user.scopeId, name: user.scopeName, level: user.scopeLevel, createdAt: "" };
}

/* ------------------------------ detail pane ------------------------------ */

function StatTile({ eyebrow, value, tone }: { eyebrow: string; value: string; tone?: "pending" }) {
  return (
    <div
      style={{
        background: "var(--color-card)",
        border: "1px solid var(--color-border)",
        borderRadius: 12,
        padding: "11px 13px",
      }}
    >
      <Eyebrow color={tone === "pending" ? "var(--color-on-device-fg)" : undefined}>{eyebrow}</Eyebrow>
      <div
        className="rl-num"
        style={{
          fontSize: 21,
          fontWeight: 800,
          marginTop: 4,
          color: tone === "pending" ? "var(--color-on-device-fg)" : undefined,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function ScopeDetailPane({
  scope,
  isOwnScope,
  detail,
  onPick,
  onCreate,
}: {
  scope: Scope;
  isOwnScope: boolean;
  detail: ScopeDetail | null;
  onPick: (id: string) => void;
  onCreate: () => void;
}) {
  const childLevel = childLevelOf(scope.level);
  const u = detail?.stats?.users;
  const pathNames = detail?.path.map((s) => s.name) ?? [];

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {pathNames.length > 1 ? (
            <div style={{ fontSize: 11.5, color: "var(--color-ink-subtle)", marginBottom: 4 }}>
              {pathNames.join(" › ")}
            </div>
          ) : null}
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
            <h2 style={{ fontSize: 18, fontWeight: 800 }}>{scope.name}</h2>
            <Chip tone="role" size="mini">
              {LEVEL_LABEL[scope.level]}
            </Chip>
            {isOwnScope ? (
              <span style={{ fontSize: 11, color: "var(--color-ink-faint)", fontWeight: 700 }}>
                your scope
              </span>
            ) : null}
          </div>
        </div>
        {childLevel ? (
          <button
            type="button"
            onClick={onCreate}
            style={{
              height: 40,
              padding: "0 16px",
              background: "var(--color-primary)",
              color: "#ffffff",
              border: "none",
              borderRadius: 999,
              fontSize: 12.5,
              fontWeight: 800,
              cursor: "pointer",
              fontFamily: "inherit",
              flexShrink: 0,
            }}
          >
            + Add {LEVEL_LABEL[childLevel].toLowerCase()}
          </button>
        ) : null}
        <Link
          href="/admin/import"
          style={{
            height: 40,
            padding: "0 16px",
            border: "1.5px solid var(--color-primary)",
            color: "var(--color-primary)",
            background: "var(--color-card)",
            borderRadius: 999,
            fontSize: 12.5,
            fontWeight: 800,
            display: "inline-flex",
            alignItems: "center",
            textDecoration: "none",
            flexShrink: 0,
          }}
        >
          Import users (CSV)
        </Link>
      </div>

      {/* Live counts */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        <StatTile eyebrow="Users" value={u ? fmt(u.total) : "—"} />
        <StatTile eyebrow="Active" value={u ? fmt(u.active) : "—"} />
        <StatTile
          eyebrow="Pending activation"
          value={u ? fmt(u.pendingActivation) : "—"}
          tone={u && u.pendingActivation > 0 ? "pending" : undefined}
        />
        <StatTile
          eyebrow="Students · Teachers"
          value={u ? `${fmt(u.students)} · ${fmt(u.teachers)}` : "—"}
        />
      </div>

      {/* Direct children */}
      <div
        style={{
          background: "var(--color-card)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "10px 16px",
            fontSize: 10.5,
            fontWeight: 800,
            letterSpacing: "0.06em",
            color: "var(--color-ink-subtle)",
            borderBottom: "1.5px solid var(--color-border)",
            textTransform: "uppercase",
          }}
        >
          {childLevel ? `${LEVEL_LABEL[childLevel]}s directly under ${scope.name}` : "School scope"}
          {detail ? ` · ${fmt(detail.children.length)}` : ""}
        </div>
        {!detail ? (
          <div style={{ padding: "13px 16px", fontSize: 12.5, color: "var(--color-ink-subtle)" }}>
            Loading…
          </div>
        ) : detail.children.length === 0 ? (
          <div style={{ padding: "16px" }}>
            {childLevel ? (
              <>
                <div style={{ fontSize: 14, fontWeight: 800 }}>
                  {scope.name} has no {LEVEL_LABEL[childLevel].toLowerCase()}s yet
                </div>
                <p style={{ fontSize: 12, color: "var(--color-ink-subtle)", lineHeight: 1.55, marginTop: 5 }}>
                  Add the first one, or bulk-import users once the scopes exist.
                </p>
                <button
                  type="button"
                  onClick={onCreate}
                  style={{
                    height: 38,
                    marginTop: 10,
                    padding: "0 15px",
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 800,
                    background: "var(--color-primary)",
                    color: "#ffffff",
                    border: "none",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  + Add first {LEVEL_LABEL[childLevel].toLowerCase()}
                </button>
              </>
            ) : (
              <p style={{ fontSize: 12.5, color: "var(--color-ink-subtle)", lineHeight: 1.55, margin: 0 }}>
                Schools are the last level — manage this school&rsquo;s people in{" "}
                <Link href="/admin/users" style={{ color: "var(--color-primary)", fontWeight: 700 }}>
                  Users
                </Link>
                .
              </p>
            )}
          </div>
        ) : (
          detail.children.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onPick(c.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                textAlign: "left",
                padding: "11px 16px",
                border: "none",
                borderBottom: i === detail.children.length - 1 ? "none" : "1px solid var(--color-divider)",
                background: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 13,
                fontWeight: 600,
                color: "var(--color-ink)",
              }}
            >
              <span style={{ flex: 1 }}>{c.name}</span>
              <span style={{ fontSize: 11.5, color: "var(--color-ink-subtle)" }}>
                {LEVEL_LABEL[c.level]} →
              </span>
            </button>
          ))
        )}
      </div>

      <p style={{ fontSize: 11.5, color: "var(--color-ink-subtle)", lineHeight: 1.5, margin: 0 }}>
        Counts cover the whole subtree under this scope. Content owned by an ancestor scope is
        visible to every scope below it — downward inheritance; siblings stay isolated.
      </p>
    </>
  );
}

/* ---------------------------- create-scope dialog ---------------------------- */

function CreateScopeDialog({
  parent,
  onClose,
  onCreated,
}: {
  parent: Scope;
  onClose: () => void;
  onCreated: () => void;
}) {
  const level = childLevelOf(parent.level);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!level) return null;

  async function submit() {
    const childLevel = childLevelOf(parent.level);
    if (busy || name.trim().length === 0 || !childLevel) return;
    setBusy(true);
    setError(null);
    const body: CreateScopeRequest = { name: name.trim(), level: childLevel, parentId: parent.id };
    try {
      await apiPost<Scope>("/scopes", body);
      onCreated();
    } catch (err) {
      setError(getErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Add a ${LEVEL_LABEL[level].toLowerCase()} under ${parent.name}`}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(12,19,34,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 80,
        padding: 20,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        style={{
          background: "var(--color-card)",
          borderRadius: 16,
          padding: "20px 20px 18px",
          width: 400,
          maxWidth: "100%",
        }}
      >
        <div className="rl-overline">New scope</div>
        <h2 style={{ fontSize: 16, fontWeight: 800, marginTop: 6 }}>
          Add a {LEVEL_LABEL[level].toLowerCase()} under {parent.name}
        </h2>
        <p style={{ fontSize: 12, color: "var(--color-ink-subtle)", lineHeight: 1.5, marginTop: 4 }}>
          Every scope sits exactly one level below its parent — this one will be a{" "}
          <strong style={{ color: "var(--color-ink)" }}>{LEVEL_LABEL[level].toLowerCase()}</strong>{" "}
          inside {parent.name}.
        </p>
        <form
          style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span className="rl-label" style={{ margin: 0 }}>
              {LEVEL_LABEL[level]} name
            </span>
            <input
              className="rl-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              autoFocus
            />
          </label>
          {error ? <AdminErrorBanner>{error}</AdminErrorBanner> : null}
          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              style={{
                height: 44,
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
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || name.trim().length === 0}
              style={{
                height: 44,
                flex: 2,
                background: "var(--color-primary)",
                color: "#ffffff",
                border: "none",
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 800,
                cursor: busy ? "default" : "pointer",
                fontFamily: "inherit",
                opacity: busy || name.trim().length === 0 ? 0.7 : 1,
              }}
            >
              {busy ? "Creating…" : `Create ${LEVEL_LABEL[level].toLowerCase()}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
