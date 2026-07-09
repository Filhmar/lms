"use client";

/**
 * User management console (Phase I, wired) — desktop layout per umg-a/b/c:
 * title block → toolbar (search `/`, filter chips, Export, + Add user) →
 * DSK data table (sortable · selectable · bulk bar · row ⋯ menu) →
 * pagination (rows-per-page + numbered pagers).
 *   · GET  /users        (scope/role/status/q filters + pagination)
 *   · POST /users        (create — role must match the scope's level)
 *   · PATCH /users/:id   (name/role/status/phone; disable/enable)
 * Sort is client-side over the CURRENT page (the list API has no sort
 * param yet); bulk actions are Disable (confirmed, names the count) and
 * client-side CSV export of the selection / current page. "Move school…"
 * and "Resend invite" from the export have no backend yet — omitted, not
 * faked (spec deviations §8.16).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BulkBar,
  BulkPill,
  DataTable,
  Dialog,
  FilterSelect,
  Icon,
  MeatballMenu,
  Pagination,
  SearchField,
  Toast,
  type DataTableColumn,
  type TableSort,
} from "@rl/ui";
import type {
  CreateUserRequest,
  ListUsersResponse,
  UpdateUserRequest,
  User,
  UserRole,
  UserStatus,
} from "@rl/schemas";
import { normalizePhPhone, RoleLevel, UserRoles, UserStatuses } from "@rl/schemas";
import { apiGet, apiPatch, apiPost, getErrorMessage } from "@/lib/api";
import { initialsOf, useSession } from "@/lib/session";
import { AdminChrome, AdminErrorBanner, AdminSelect, LEVEL_LABEL, ScopeSelect, useSubtree } from "../chrome";
import { HealthDot } from "../ui";

const fmt = (n: number) => n.toLocaleString("en-US");

const ROLE_LABEL: Record<UserRole, string> = {
  student: "Student",
  teacher: "Teacher",
  school_admin: "School admin",
  district_admin: "District admin",
  division_admin: "Division admin",
  region_admin: "Region admin",
  central_admin: "Central admin",
};

const STATUS_LABEL: Record<UserStatus, string> = {
  active: "Active",
  pending_activation: "Pending activation",
  disabled: "Disabled",
};

function statusTone(status: UserStatus): "fresh" | "lagging" | "stale" {
  return status === "active" ? "fresh" : status === "pending_activation" ? "lagging" : "stale";
}

/** Role chip colors per §2.1 (teacher/admin tints are desktop additions). */
function RoleChip({ role }: { role: UserRole }) {
  const style: React.CSSProperties =
    role === "student"
      ? { background: "var(--color-primary-tint)", color: "var(--color-primary)" }
      : role === "teacher"
        ? { background: "var(--color-teacher-chip-bg)", color: "var(--color-synced-fg)" }
        : { background: "var(--color-canvas)", color: "var(--color-ink-subtle)" };
  return (
    <span
      style={{
        display: "inline-flex",
        borderRadius: 999,
        padding: "3px 10px",
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {ROLE_LABEL[role]}
    </span>
  );
}

/** Avatar bg: students primary, staff ink, pending/disabled neutral. */
function avatarBg(row: User): string {
  if (row.status !== "active") return "var(--color-avatar-neutral)";
  return row.role === "student" ? "var(--color-primary)" : "var(--color-ink)";
}

function exportCsv(rows: User[], filename: string) {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [
    "full_name,email,role,scope,status",
    ...rows.map((r) =>
      [r.fullName, r.email, r.role, `${r.scopeName} (${LEVEL_LABEL[r.scopeLevel]})`, r.status]
        .map(esc)
        .join(","),
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function UsersPage() {
  return (
    <AdminChrome title="Users">
      <UsersBody />
    </AdminChrome>
  );
}

function UsersBody() {
  const { user } = useSession();
  const rootId = user?.scopeId ?? null;
  const { scopes } = useSubtree(rootId);

  /* filters */
  const [scopeId, setScopeId] = useState<string>("");
  const [role, setRole] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  /* debounce the search box (300ms, server-side) */
  useEffect(() => {
    const t = window.setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [search]);

  /* list state */
  const [list, setList] = useState<ListUsersResponse | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const refetch = () => setNonce((n) => n + 1);

  useEffect(() => {
    if (!rootId) return;
    let cancelled = false;
    setListError(null);
    const params = new URLSearchParams();
    params.set("scopeId", scopeId || rootId);
    params.set("includeDescendants", "true");
    if (role) params.set("role", role);
    if (status) params.set("status", status);
    if (q) params.set("q", q);
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    apiGet<ListUsersResponse>(`/users?${params.toString()}`)
      .then((res) => {
        if (!cancelled) setList(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setListError(getErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [rootId, scopeId, role, status, q, page, pageSize, nonce]);

  /* sort — client-side over the current page (no server sort param yet) */
  const [sort, setSort] = useState<TableSort | null>(null);
  const rows = useMemo(() => {
    const items = list?.items ?? [];
    if (!sort) return items;
    const value = (r: User): string =>
      sort.key === "name"
        ? r.fullName
        : sort.key === "role"
          ? ROLE_LABEL[r.role]
          : sort.key === "scope"
            ? r.scopeName
            : STATUS_LABEL[r.status];
    const sorted = [...items].sort((a, b) => value(a).localeCompare(value(b)));
    return sort.dir === "desc" ? sorted.reverse() : sorted;
  }, [list, sort]);

  /* selection (per page — cleared when the page of data changes) */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => setSelected(new Set()), [list]);
  const selectedRows = rows.filter((r) => selected.has(r.id));

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [confirmDisable, setConfirmDisable] = useState<User[] | null>(null);
  const [busyBulk, setBusyBulk] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3200);
  };

  async function disableAccounts(targets: User[]) {
    if (busyBulk) return;
    setBusyBulk(true);
    let failed = 0;
    for (const t of targets) {
      if (t.status === "disabled") continue;
      try {
        await apiPatch<User>(`/users/${t.id}`, { status: "disabled" } satisfies UpdateUserRequest);
      } catch {
        failed += 1;
      }
    }
    setBusyBulk(false);
    setConfirmDisable(null);
    setSelected(new Set());
    refetch();
    showToast(
      failed === 0
        ? `${targets.length === 1 ? "Account" : `${targets.length} accounts`} disabled — you can re-enable anytime.`
        : `${failed} of ${targets.length} couldn't be disabled — check and try again.`,
    );
  }

  if (!user) return null;

  const total = list?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = list ? Math.min(total, (page - 1) * pageSize + list.items.length) : 0;
  const filtersActive = Boolean(role || status || q);
  const disableTargets = selectedRows.filter((r) => r.status !== "disabled");

  const columns: DataTableColumn<User>[] = [
    {
      key: "name",
      label: "Name",
      width: "2.2fr",
      sortable: true,
      render: (row) => (
        <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span
            aria-hidden
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: avatarBg(row),
              color: "#fff",
              fontSize: 11,
              fontWeight: 800,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {initialsOf(row.fullName)}
          </span>
          <span style={{ minWidth: 0 }}>
            <span
              style={{
                display: "block",
                fontWeight: 600,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {row.fullName}
            </span>
            <span
              style={{
                display: "block",
                fontSize: 11,
                color: "var(--color-ink-subtle)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {row.email}
            </span>
          </span>
        </span>
      ),
    },
    { key: "role", label: "Role", width: "1fr", sortable: true, render: (row) => <RoleChip role={row.role} /> },
    {
      key: "scope",
      label: "School / scope",
      width: "1.6fr",
      sortable: true,
      render: (row) => (
        <span
          style={{
            display: "block",
            color: "var(--color-ink-secondary)",
            fontSize: 12.5,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {row.scopeName}
          <span style={{ color: "var(--color-ink-faint)" }}> · {LEVEL_LABEL[row.scopeLevel]}</span>
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      width: "1.1fr",
      sortable: true,
      render: (row) => <HealthDot tone={statusTone(row.status)}>{STATUS_LABEL[row.status]}</HealthDot>,
    },
  ];

  return (
    <div style={{ padding: "18px 22px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Title block */}
      <div>
        <h1 style={{ fontSize: 19, fontWeight: 800, margin: 0 }}>Users</h1>
        <div className="rl-num" style={{ fontSize: 12, color: "var(--color-ink-subtle)", marginTop: 2 }}>
          {list ? `${fmt(total)} ${total === 1 ? "person" : "people"} in ` : "People in "}
          {scopes?.find((s) => s.id === (scopeId || rootId))?.name ?? user.scopeName}
        </div>
      </div>

      {/* Toolbar / filter row */}
      <div className="rl-toolbar" style={{ padding: 0, border: "none", flexWrap: "wrap" }}>
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Search name or email…"
          width={280}
          hotkey
        />
        <FilterSelect
          prefix="Scope"
          value={scopeId || rootId || ""}
          display={
            (scopeId && scopes?.find((s) => s.id === scopeId)?.name) || user.scopeName
          }
          active={Boolean(scopeId) && scopeId !== rootId}
          onChange={(v) => {
            setScopeId(v);
            setPage(1);
          }}
          options={(scopes ?? []).map((s) => ({ value: s.id, label: `${s.name} (${LEVEL_LABEL[s.level]})` }))}
        />
        <FilterSelect
          prefix="Role"
          value={role}
          display={role ? ROLE_LABEL[role as UserRole] : "All"}
          active={Boolean(role)}
          onChange={(v) => {
            setRole(v);
            setPage(1);
          }}
          options={[{ value: "", label: "All roles" }, ...UserRoles.map((r) => ({ value: r, label: ROLE_LABEL[r] }))]}
        />
        <FilterSelect
          prefix="Status"
          value={status}
          display={status ? STATUS_LABEL[status as UserStatus] : "All"}
          active={Boolean(status)}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={[
            { value: "", label: "All statuses" },
            ...UserStatuses.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
          ]}
        />
        <span className="rl-toolbar__right">
          <button
            type="button"
            className="rl-toolbtn"
            disabled={rows.length === 0}
            onClick={() => exportCsv(rows, "users-page.csv")}
          >
            <Icon name="download" size={14} />
            Export
          </button>
          <button type="button" className="rl-toolbtn rl-toolbtn--primary" onClick={() => setCreateOpen(true)}>
            + Add user
          </button>
        </span>
      </div>

      {listError ? <AdminErrorBanner>{listError}</AdminErrorBanner> : null}

      {/* Table */}
      <DataTable<User>
        aria-label="Users in your scope"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        sort={sort}
        onSortChange={setSort}
        selectable
        selected={selected}
        onSelectedChange={setSelected}
        onRowOpen={(row) => setEditing(row)}
        bulkBar={
          <BulkBar
            count={selected.size}
            onClear={() => setSelected(new Set())}
            onToggleAll={() => setSelected(new Set())}
          >
            <BulkPill
              icon={<Icon name="pause" size={12} />}
              disabled={disableTargets.length === 0 || busyBulk}
              onClick={() => setConfirmDisable(disableTargets)}
            >
              Disable
            </BulkPill>
            <BulkPill
              icon={<Icon name="download" size={12} />}
              onClick={() => exportCsv(selectedRows, "users-selection.csv")}
            >
              Export CSV
            </BulkPill>
          </BulkBar>
        }
        rowMenu={(row) => (
          <MeatballMenu
            label={`Actions for ${row.fullName}`}
            items={[
              {
                key: "edit",
                label: "Edit details",
                onSelect: () => setEditing(row),
              },
              row.status === "disabled"
                ? {
                    key: "enable",
                    label: "Enable account",
                    onSelect: () => void disableToggleOne(row, "active"),
                  }
                : {
                    key: "disable",
                    label: "Disable account",
                    destructive: true,
                    onSelect: () => setConfirmDisable([row]),
                  },
            ]}
          />
        )}
        empty={
          !list && !listError ? (
            <div style={{ padding: "14px 16px", fontSize: 12.5, color: "var(--color-ink-subtle)" }}>
              Loading people in your scope…
            </div>
          ) : (
            <div style={{ padding: "40px 24px", textAlign: "center" }}>
              <div
                style={{
                  width: 54,
                  height: 54,
                  borderRadius: "50%",
                  background: "var(--color-canvas)",
                  color: "var(--color-ink-subtle)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon name="users" size={24} />
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, marginTop: 10 }}>
                {q ? `No users match "${q}"` : "No one matches these filters"}
              </div>
              <p
                style={{
                  fontSize: 12.5,
                  color: "var(--color-ink-subtle)",
                  lineHeight: 1.55,
                  marginTop: 5,
                }}
              >
                Try another search or clear the filters — or create the first account with “+ Add
                user”.
              </p>
              {filtersActive ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setRole("");
                    setStatus("");
                    setPage(1);
                  }}
                  style={{
                    height: 40,
                    marginTop: 10,
                    padding: "0 18px",
                    border: "1.5px solid var(--color-border)",
                    background: "var(--color-card)",
                    color: "var(--color-primary)",
                    borderRadius: 999,
                    fontSize: 12.5,
                    fontWeight: 800,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Clear filters
                </button>
              ) : null}
            </div>
          )
        }
        footer={
          list ? (
            <Pagination
              page={page}
              pageCount={lastPage}
              onPage={(p) => setPage(Math.min(lastPage, Math.max(1, p)))}
              pageSize={pageSize}
              onPageSize={(n) => {
                setPageSize(n);
                setPage(1);
              }}
              rangeLabel={total === 0 ? "0 people" : `${fmt(from)}–${fmt(to)} of ${fmt(total)}`}
            />
          ) : null
        }
      />

      {createOpen ? (
        <CreateUserDialog
          scopes={scopes}
          defaultScopeId={scopeId || rootId || ""}
          onClose={() => setCreateOpen(false)}
          onDone={() => {
            setCreateOpen(false);
            refetch();
          }}
        />
      ) : null}
      {editing ? (
        <EditUserDialog
          target={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            refetch();
          }}
        />
      ) : null}

      {/* Destructive bulk actions confirm in a dialog naming the count */}
      {confirmDisable ? (
        <Dialog
          label={
            confirmDisable.length === 1
              ? "Disable this account?"
              : `Disable ${confirmDisable.length} accounts?`
          }
          onClose={() => setConfirmDisable(null)}
          width={340}
        >
          <div style={{ fontSize: 16, fontWeight: 800 }}>
            {confirmDisable.length === 1
              ? "Disable this account?"
              : `Disable ${confirmDisable.length} accounts?`}
          </div>
          <p style={{ fontSize: 12.5, color: "var(--color-ink-subtle)", lineHeight: 1.5, marginTop: 7 }}>
            {confirmDisable.length === 1 ? (
              <>
                <b style={{ color: "var(--color-ink)" }}>{confirmDisable[0]!.fullName}</b> won&rsquo;t
                be able to sign in. Their saved work and grades stay safe. You can re-enable anytime.
              </>
            ) : (
              <>
                These {confirmDisable.length} people won&rsquo;t be able to sign in. Their saved work
                and grades stay safe. You can re-enable anytime.
              </>
            )}
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button
              type="button"
              data-autofocus
              onClick={() => setConfirmDisable(null)}
              disabled={busyBulk}
              style={{
                flex: 1,
                height: 42,
                border: "1.5px solid var(--color-border)",
                color: "var(--color-ink-subtle)",
                background: "var(--color-card)",
                borderRadius: 999,
                fontSize: 12.5,
                fontWeight: 800,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void disableAccounts(confirmDisable)}
              disabled={busyBulk}
              style={{
                flex: 1,
                height: 42,
                border: "none",
                background: "var(--color-destructive)",
                color: "#fff",
                borderRadius: 999,
                fontSize: 12.5,
                fontWeight: 800,
                cursor: busyBulk ? "default" : "pointer",
                fontFamily: "inherit",
                opacity: busyBulk ? 0.7 : 1,
              }}
            >
              {busyBulk ? "Disabling…" : "Disable"}
            </button>
          </div>
        </Dialog>
      ) : null}

      {/* toast — bottom-left at desktop */}
      {toast ? (
        <div style={{ position: "fixed", bottom: 24, left: 24, zIndex: 90 }}>
          <Toast>{toast}</Toast>
        </div>
      ) : null}
    </div>
  );

  async function disableToggleOne(row: User, next: UserStatus) {
    try {
      await apiPatch<User>(`/users/${row.id}`, { status: next } satisfies UpdateUserRequest);
      refetch();
      showToast(next === "active" ? `${row.fullName} can sign in again.` : `${row.fullName} disabled.`);
    } catch (err) {
      showToast(getErrorMessage(err));
    }
  }
}

/* ------------------------------ dialogs ------------------------------ */

function DialogField({
  label,
  value,
  onChange,
  error,
  placeholder,
  inputMode,
  type,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  placeholder?: string;
  inputMode?: "email" | "tel" | "text";
  type?: string;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span className="rl-label" style={{ margin: 0 }}>
        {label}
      </span>
      <input
        className={`rl-input${error ? " rl-input--error" : ""}`}
        value={value}
        type={type}
        inputMode={inputMode}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{ height: 42, fontSize: 14 }}
      />
      {error ? (
        <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--color-attention-fg)" }}>
          {error}
        </span>
      ) : null}
    </label>
  );
}

function dialogButtons(busy: boolean, submitLabel: string, onClose: () => void) {
  return (
    <div style={{ display: "flex", gap: 10, marginTop: 2 }}>
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
        disabled={busy}
        style={{
          height: 44,
          flex: 1.4,
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
        {submitLabel}
      </button>
    </div>
  );
}

function CreateUserDialog({
  scopes,
  defaultScopeId,
  onClose,
  onDone,
}: {
  scopes: ReturnType<typeof useSubtree>["scopes"];
  defaultScopeId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [scopeId, setScopeId] = useState(defaultScopeId);
  const [role, setRole] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);

  const scopeLevel = useMemo(
    () => scopes?.find((s) => s.id === scopeId)?.level ?? null,
    [scopes, scopeId],
  );
  /** The role↔level invariant: only roles anchored at the picked scope's level. */
  const allowedRoles = useMemo(
    () => (scopeLevel ? UserRoles.filter((r) => RoleLevel[r] === scopeLevel) : []),
    [scopeLevel],
  );
  useEffect(() => {
    if (allowedRoles.length > 0 && !allowedRoles.includes(role as UserRole)) {
      setRole(allowedRoles[0]!);
    }
  }, [allowedRoles, role]);

  const normalizedPhone = normalizePhPhone(phone);
  const phoneError =
    attempted && phone.trim().length > 0 && !normalizedPhone
      ? "Use a Philippine mobile number, e.g. 09171234567."
      : attempted && phone.trim().length === 0
        ? "A mobile number is needed — the activation code is texted to it."
        : undefined;

  async function submit() {
    setAttempted(true);
    if (busy) return;
    if (!fullName.trim() || !email.trim() || !normalizedPhone || !role || !scopeId) return;
    setBusy(true);
    setError(null);
    const body: CreateUserRequest = {
      email: email.trim(),
      fullName: fullName.trim(),
      role: role as UserRole,
      scopeId,
      phone: normalizedPhone,
    };
    try {
      await apiPost<User>("/users", body);
      onDone();
    } catch (err) {
      setError(getErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Dialog label="Add a user" onClose={busy ? () => undefined : onClose} width={420} form>
      <div className="rl-overline">New user</div>
      <h2 style={{ fontSize: 16, fontWeight: 800, marginTop: 6 }}>Add a user</h2>
      <p style={{ fontSize: 12, color: "var(--color-ink-subtle)", lineHeight: 1.5, marginTop: 4 }}>
        New accounts start as pending activation — the person gets a texted code to set their
        password.
      </p>
      <form
        style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <DialogField
          label="Full name"
          value={fullName}
          onChange={setFullName}
          error={attempted && !fullName.trim() ? "Enter the person's full name." : undefined}
        />
        <DialogField
          label="Email"
          value={email}
          onChange={setEmail}
          inputMode="email"
          error={attempted && !email.trim() ? "Enter the email they'll sign in with." : undefined}
        />
        <DialogField
          label="Mobile number"
          value={phone}
          onChange={setPhone}
          inputMode="tel"
          placeholder="09171234567"
          error={phoneError}
        />
        <ScopeSelect label="Scope" scopes={scopes} value={scopeId} onChange={setScopeId} />
        <AdminSelect label="Role" value={role} onChange={setRole} disabled={allowedRoles.length === 0}>
          {allowedRoles.length === 0 ? <option value="">Pick a scope first</option> : null}
          {allowedRoles.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </AdminSelect>
        <div
          style={{
            background: "var(--color-canvas)",
            borderRadius: 10,
            padding: "9px 12px",
            fontSize: 11.5,
            color: "var(--color-ink-subtle)",
            lineHeight: 1.5,
            display: "flex",
            gap: 7,
            alignItems: "flex-start",
          }}
        >
          <Icon name="lock" size={13} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            Scope is fixed to your own tree — you can only place users below your scope.
            {scopeLevel
              ? ` A ${LEVEL_LABEL[scopeLevel].toLowerCase()} scope holds ${allowedRoles
                  .map((r) => ROLE_LABEL[r].toLowerCase())
                  .join(", ")} accounts only.`
              : ""}
          </span>
        </div>
        {error ? <AdminErrorBanner>{error}</AdminErrorBanner> : null}
        {dialogButtons(busy, busy ? "Creating…" : "Add & send invite", onClose)}
      </form>
    </Dialog>
  );
}

function EditUserDialog({
  target,
  onClose,
  onDone,
}: {
  target: User;
  onClose: () => void;
  onDone: () => void;
}) {
  const [fullName, setFullName] = useState(target.fullName);
  const [role, setRole] = useState<UserRole>(target.role);
  const [status, setStatus] = useState<UserStatus>(target.status);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Same invariant on edit: roles anchored at the user's scope level. */
  const allowedRoles = UserRoles.filter((r) => RoleLevel[r] === target.scopeLevel);
  const statusOptions: UserStatus[] =
    target.status === "pending_activation"
      ? ["pending_activation", "active", "disabled"]
      : ["active", "disabled"];

  const normalizedPhone = phone.trim() ? normalizePhPhone(phone) : null;
  const phoneError =
    phone.trim().length > 0 && !normalizedPhone
      ? "Use a Philippine mobile number, e.g. 09171234567."
      : undefined;

  async function submit() {
    if (busy || phoneError) return;
    const body: UpdateUserRequest = {};
    if (fullName.trim() && fullName.trim() !== target.fullName) body.fullName = fullName.trim();
    if (role !== target.role) body.role = role;
    if (status !== target.status) body.status = status;
    if (normalizedPhone) body.phone = normalizedPhone;
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiPatch<User>(`/users/${target.id}`, body);
      onDone();
    } catch (err) {
      setError(getErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Dialog label={`Edit user ${target.fullName}`} onClose={busy ? () => undefined : onClose} width={420} form>
      <div className="rl-overline">Edit user</div>
      <h2 style={{ fontSize: 16, fontWeight: 800, marginTop: 6 }}>{target.fullName}</h2>
      <p style={{ fontSize: 12, color: "var(--color-ink-subtle)", lineHeight: 1.5, marginTop: 4 }}>
        {target.email} · {target.scopeName} ({LEVEL_LABEL[target.scopeLevel]})
      </p>
      <form
        style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <DialogField label="Full name" value={fullName} onChange={setFullName} />
        <AdminSelect label="Role" value={role} onChange={(v) => setRole(v as UserRole)}>
          {allowedRoles.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </AdminSelect>
        <AdminSelect label="Status" value={status} onChange={(v) => setStatus(v as UserStatus)}>
          {statusOptions.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </AdminSelect>
        <DialogField
          label="New mobile number (leave blank to keep the current one)"
          value={phone}
          onChange={setPhone}
          inputMode="tel"
          placeholder={target.phoneMasked ?? "09171234567"}
          error={phoneError}
        />
        {status === "disabled" && target.status !== "disabled" ? (
          <p style={{ fontSize: 11.5, color: "var(--color-ink-subtle)", lineHeight: 1.5, margin: 0 }}>
            Disabling blocks sign-in on new devices. Work already saved on their device stays safe
            and sends once the account is enabled again.
          </p>
        ) : null}
        {error ? <AdminErrorBanner>{error}</AdminErrorBanner> : null}
        {dialogButtons(busy, busy ? "Saving…" : "Save changes", onClose)}
      </form>
    </Dialog>
  );
}
