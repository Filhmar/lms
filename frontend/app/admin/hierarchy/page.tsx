"use client";

/**
 * Hierarchy console, wired to the live API — desktop layout per hier-a:
 * TRUE tree (left, role="tree", ↑↓←→ keyboard) + scope detail panel (right).
 *   · GET /scopes/:id/subtree   (flat closure list: scope + depth)
 *   · GET /scopes/:id/stats     (selected-scope counts)
 *   · GET /scopes/:id/breadcrumb(selected-scope path)
 *   · POST /scopes              (create a child scope, invariants surfaced)
 * The subtree payload carries NO parent links, so nesting is inferred
 * lazily: expanding a node fetches ITS subtree once and reads depth === 1
 * as its direct children (one sparing call per expanded node, cached).
 * Ancestors above the admin's scope render muted — orientation only,
 * never selectable. Any 403 renders the designed scope wall.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Chip, Icon, TreeView, type TreeItem } from "@rl/ui";
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

interface ScopeDetail {
  stats: ScopeStatsResponse | null;
  children: ScopeWithDepth[];
  path: ScopeWithDepth[];
}

const byName = (a: ScopeWithDepth, b: ScopeWithDepth) => a.name.localeCompare(b.name);

export default function HierarchyPage() {
  const [query, setQuery] = useState("");
  return (
    <AdminChrome
      title="Hierarchy"
      note="Your scope — you can't see sibling scopes"
      barExtra={
        <label className="rl-search" style={{ width: 260, height: 36 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden style={{ flexShrink: 0 }}>
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth={2.2} />
            <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search within your scope…"
            aria-label="Search within your scope"
            data-hotkey-search="true"
          />
        </label>
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

  /* ------- lazy tree data: scopeId → direct children (depth === 1) ------- */
  const [childrenMap, setChildrenMap] = useState<Record<string, ScopeWithDepth[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const inflight = useRef(new Set<string>());

  /* the root subtree we already have seeds the root's children */
  useEffect(() => {
    if (!scopes || !rootId) return;
    setChildrenMap((prev) =>
      prev[rootId] ? prev : { ...prev, [rootId]: scopes.filter((s) => s.depth === 1).sort(byName) },
    );
    setExpanded((prev) => {
      if (prev.has(rootId)) return prev;
      const next = new Set(prev);
      next.add(rootId);
      return next;
    });
  }, [scopes, rootId]);

  const loadChildren = useCallback(
    (id: string) => {
      if (childrenMap[id] || inflight.current.has(id)) return;
      inflight.current.add(id);
      setLoadingIds((prev) => new Set(prev).add(id));
      apiGet<SubtreeResponse>(`/scopes/${id}/subtree`)
        .then((res) => {
          setChildrenMap((prev) => ({
            ...prev,
            [id]: res.scopes.filter((s) => s.depth === 1).sort(byName),
          }));
        })
        .catch(() => undefined)
        .finally(() => {
          inflight.current.delete(id);
          setLoadingIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        });
    },
    [childrenMap],
  );

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
        const children = subtree.scopes.filter((s) => s.depth === 1).sort(byName);
        setDetail({ stats, children, path: crumb?.chain ?? [] });
        // the detail fetch doubles as the tree's lazy loader for this node
        setChildrenMap((prev) => ({ ...prev, [effectiveSelected]: children }));
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

  const scopeById = useMemo(() => {
    const map = new Map<string, { id: string; name: string; level: ScopeLevel }>();
    if (user) map.set(user.scopeId, { id: user.scopeId, name: user.scopeName, level: user.scopeLevel });
    for (const s of scopes ?? []) map.set(s.id, s);
    for (const list of Object.values(childrenMap)) for (const s of list) map.set(s.id, s);
    return map;
  }, [scopes, childrenMap, user]);

  const selectedScope: Scope | null = useMemo(() => {
    if (!effectiveSelected) return null;
    const hit = scopeById.get(effectiveSelected);
    return hit ? { id: hit.id, name: hit.name, level: hit.level, createdAt: "" } : null;
  }, [scopeById, effectiveSelected]);

  /* ------------------------------- tree items ------------------------------- */
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!scopes || !q) return [];
    return scopes.filter((s) => s.name.toLowerCase().includes(q)).sort(byName);
  }, [scopes, q]);

  const buildItem = useCallback(
    (id: string, name: string, level: ScopeLevel): TreeItem => {
      const kids = childrenMap[id];
      return {
        id,
        name: `${name} · ${LEVEL_LABEL[level]}`,
        label: name,
        canExpand: level !== "school",
        badge: kids ? fmt(kids.length) : undefined,
        meta: kids && kids.length > 0 ? fmt(kids.length) : undefined,
        children: kids?.map((k) => buildItem(k.id, k.name, k.level)),
      };
    },
    [childrenMap],
  );

  const treeItems: TreeItem[] = useMemo(() => {
    if (!user) return [];
    const rootItem = buildItem(user.scopeId, user.scopeName, user.scopeLevel);
    /* ancestors above scope: muted for orientation, never selectable */
    const ancestors = (breadcrumb ?? []).slice(0, -1);
    let tree: TreeItem = rootItem;
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const a = ancestors[i]!;
      tree = {
        id: a.id,
        name: `${a.name} · ${LEVEL_LABEL[a.level]} (above your scope)`,
        label: a.name,
        muted: true,
        canExpand: true,
        children: [tree],
      };
    }
    return [tree];
  }, [user, breadcrumb, buildItem]);

  /* ancestors start expanded so the admin's own scope is visible */
  useEffect(() => {
    const ancestors = (breadcrumb ?? []).slice(0, -1);
    if (ancestors.length === 0) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const a of ancestors) next.add(a.id);
      return next;
    });
  }, [breadcrumb]);

  if (!user) return null;

  /* A 403 on the root subtree means the deep link points outside the scope. */
  if (subtreeError && subtreeError.status === 403) {
    return <ScopeWall message={subtreeError.message} />;
  }

  return (
    <div className="hier-grid">
      <style>{hierCss}</style>

      {/* ---------------- Tree pane ---------------- */}
      <div
        style={{
          borderRight: "1px solid var(--color-border)",
          padding: "16px 12px",
          background: "var(--color-card)",
          minHeight: 520,
        }}
      >
        <Eyebrow spacing="0.07em" style={{ marginBottom: 10, padding: "0 4px" }}>
          Your tree
        </Eyebrow>

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

        {!scopes && !subtreeError ? (
          <div style={{ fontSize: 12, color: "var(--color-ink-subtle)", padding: "8px 4px" }}>
            Loading your scopes…
          </div>
        ) : null}

        {q ? (
          /* search shows flat matches (stays inside scope), not the tree */
          <>
            <div style={{ fontSize: 11.5, color: "var(--color-ink-subtle)", padding: "0 4px 8px" }}>
              {fmt(matches.length)} match{matches.length === 1 ? "" : "es"} in your scope
            </div>
            {matches.length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--color-ink-subtle)", lineHeight: 1.55, padding: "0 4px" }}>
                No matches inside {user.scopeName}. Results never include sibling scopes.
              </p>
            ) : null}
            {matches.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedId(s.id)}
                className={`rl-tree__node${s.id === effectiveSelected ? " rl-tree__node--selected" : ""}`}
              >
                <span className="rl-tree__label">{s.name}</span>
                <span className="rl-tree__count">{LEVEL_LABEL[s.level]}</span>
              </button>
            ))}
          </>
        ) : (
          <TreeView
            aria-label="Your visible scopes"
            items={treeItems}
            expanded={expanded}
            loadingIds={loadingIds}
            onToggle={(id, willExpand) => {
              setExpanded((prev) => {
                const next = new Set(prev);
                if (willExpand) next.add(id);
                else next.delete(id);
                return next;
              });
              if (willExpand && !childrenMap[id] && scopeById.get(id)?.level !== "school") {
                loadChildren(id);
              }
            }}
            selectedId={effectiveSelected}
            onSelect={(id) => setSelectedId(id)}
          />
        )}

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
          Sibling scopes are never visible from here. Expanding a branch loads its children once —
          the closure payload carries no parent links, so nesting is inferred per node.
        </div>
      </div>

      {/* ---------------- Detail panel ---------------- */}
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
        ) : selectedScope ? (
          <ScopeDetailPane
            scope={selectedScope}
            isOwnScope={effectiveSelected === rootId}
            detail={detail}
            onPick={(id) => setSelectedId(id)}
            onCreate={() => setCreateOpen(true)}
          />
        ) : null}
      </div>

      {/* Create-scope dialog */}
      {createOpen && selectedScope ? (
        <CreateScopeDialog
          parent={selectedScope}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            reloadSubtree();
            setDetailNonce((n) => n + 1);
            /* refresh the cached children of the parent */
            setChildrenMap((prev) => {
              const next = { ...prev };
              delete next[selectedScope.id];
              return next;
            });
          }}
        />
      ) : null}
    </div>
  );
}

const hierCss = `
.hier-grid{display:grid;grid-template-columns:340px 1fr;}
@media (max-width:900px){.hier-grid{grid-template-columns:1fr;}.hier-grid>div:first-child{border-right:none;border-bottom:1px solid var(--color-border);min-height:0;}}
`;

/* ------------------------------ detail pane ------------------------------ */

function StatTile({ eyebrow, value, tone }: { eyebrow: string; value: string; tone?: "pending" }) {
  return (
    <div
      style={{
        background: "var(--color-card)",
        border: "1px solid var(--color-border)",
        borderRadius: 12,
        padding: "13px 15px",
      }}
    >
      <Eyebrow color={tone === "pending" ? "var(--color-on-device-fg)" : undefined}>{eyebrow}</Eyebrow>
      <div
        className="rl-num"
        style={{
          fontSize: 22,
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
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          {pathNames.length > 1 ? (
            <div style={{ fontSize: 11.5, color: "var(--color-ink-subtle)", marginBottom: 4 }}>
              {pathNames.join(" › ")}
            </div>
          ) : null}
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
            <h2 style={{ fontSize: 19, fontWeight: 800 }}>{scope.name}</h2>
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
              height: 38,
              padding: "0 15px",
              border: "1.5px solid var(--color-primary)",
              color: "var(--color-primary)",
              background: "var(--color-card)",
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
            height: 38,
            padding: "0 15px",
            background: "var(--color-primary)",
            color: "#ffffff",
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

      {/* Direct children — the DSK table shell */}
      <div className="rl-table">
        <div className="rl-table__head" style={{ gridTemplateColumns: "2fr 1fr 1fr" }}>
          <span className="rl-table__hcell">
            {childLevel ? `${LEVEL_LABEL[childLevel]}s under ${scope.name}` : "School scope"}
          </span>
          <span className="rl-table__hcell">Level</span>
          <span className="rl-table__hcell rl-num">
            {detail ? `${fmt(detail.children.length)} total` : ""}
          </span>
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
          detail.children.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onPick(c.id)}
              className="rl-table__row rl-table__row--hoverable"
              style={{ gridTemplateColumns: "2fr 1fr 1fr", cursor: "pointer" }}
            >
              <span className="rl-table__cell" style={{ fontWeight: 600 }}>
                {c.name}
              </span>
              <span className="rl-table__cell" style={{ color: "var(--color-ink-subtle)", fontSize: 12.5 }}>
                {LEVEL_LABEL[c.level]}
              </span>
              <span className="rl-table__cell rl-table__cell--right" style={{ fontSize: 11.5, color: "var(--color-ink-subtle)" }}>
                Open →
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
      className="rl-dialog-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="rl-dialog rl-dialog--form" style={{ width: 400 }}>
        <div className="rl-overline">New scope</div>
        <h2 style={{ fontSize: 16, fontWeight: 800, marginTop: 6 }}>
          Add a {LEVEL_LABEL[level].toLowerCase()} under {parent.name}
        </h2>
        <p style={{ fontSize: 12, color: "var(--color-ink-subtle)", lineHeight: 1.5, marginTop: 4 }}>
          Every scope sits exactly one level below its parent — this one will be a{" "}
          <strong style={{ color: "var(--color-ink)" }}>{LEVEL_LABEL[level].toLowerCase()}</strong>{" "}
          inside {parent.name}.
        </p>
        <div
          style={{
            background: "var(--color-canvas)",
            borderRadius: 10,
            padding: "9px 12px",
            fontSize: 11.5,
            color: "var(--color-ink-subtle)",
            lineHeight: 1.5,
            marginTop: 10,
          }}
        >
          Published {LEVEL_LABEL[parent.level].toLowerCase()} content will inherit down to this{" "}
          {LEVEL_LABEL[level].toLowerCase()} automatically.
        </div>
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
                flex: 1.3,
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
