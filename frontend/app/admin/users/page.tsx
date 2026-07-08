"use client";

/**
 * d-new — User management console (Phase I, wired).
 *   · GET  /users        (scope/role/status/q filters + pagination)
 *   · POST /users        (create — role must match the scope's level)
 *   · PATCH /users/:id   (name/role/status/phone; disable/enable)
 * Scope picker options come from GET /scopes/:id/subtree. Errors surface
 * the backend message in inline banners; mutations do a simple refetch
 * (no optimistic state).
 */

import { useEffect, useMemo, useState } from "react";
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
import { Eyebrow, HealthDot } from "../ui";

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

const COLUMNS = "2.2fr 1fr 1.4fr 1.2fr 0.7fr";

const pillButton: React.CSSProperties = {
  height: 40,
  padding: "0 16px",
  borderRadius: 999,
  fontSize: 12.5,
  fontWeight: 800,
  cursor: "pointer",
  fontFamily: "inherit",
};

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
  const pageSize = 20;

  /* debounce the search box */
  useEffect(() => {
    const t = window.setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 350);
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
  }, [rootId, scopeId, role, status, q, page, nonce]);

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);

  if (!user) return null;

  const total = list?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = list ? Math.min(total, (page - 1) * pageSize + list.items.length) : 0;

  return (
    <div style={{ padding: "18px 22px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Filters row */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
        <div style={{ minWidth: 220, flex: "1 1 220px" }}>
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
        <div style={{ width: 160 }}>
          <AdminSelect
            label="Role"
            value={role}
            onChange={(v) => {
              setRole(v);
              setPage(1);
            }}
          >
            <option value="">All roles</option>
            {UserRoles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </AdminSelect>
        </div>
        <div style={{ width: 180 }}>
          <AdminSelect
            label="Status"
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {UserStatuses.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </AdminSelect>
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 5, flex: "1 1 200px" }}>
          <span className="rl-label" style={{ margin: 0 }}>
            Search
          </span>
          <input
            type="search"
            className="rl-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or email…"
            style={{ height: 44, fontSize: 13 }}
          />
        </label>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          style={{
            ...pillButton,
            height: 44,
            background: "var(--color-primary)",
            color: "#ffffff",
            border: "none",
            flexShrink: 0,
          }}
        >
          + New user
        </button>
      </div>

      {listError ? <AdminErrorBanner>{listError}</AdminErrorBanner> : null}

      {/* Table */}
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
          <span>Name</span>
          <span>Role</span>
          <span>Scope</span>
          <span>Status</span>
          <span />
        </div>

        {!list && !listError ? (
          <div style={{ padding: "14px 16px", fontSize: 12.5, color: "var(--color-ink-subtle)" }}>
            Loading people in your scope…
          </div>
        ) : null}

        {list && list.items.length === 0 ? (
          <div style={{ padding: "16px", fontSize: 12.5, color: "var(--color-ink-subtle)", lineHeight: 1.55 }}>
            No one matches these filters. Widen the scope or clear the search — or create the first
            account with “+ New user”.
          </div>
        ) : null}

        {list?.items.map((row, i) => (
          <div
            key={row.id}
            style={{
              display: "grid",
              gridTemplateColumns: COLUMNS,
              alignItems: "center",
              padding: "10px 16px",
              fontSize: 13,
              borderBottom: i === list.items.length - 1 ? "none" : "1px solid var(--color-divider)",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <span
                aria-hidden
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: "var(--color-primary-tint)",
                  color: "var(--color-primary)",
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
                <span style={{ display: "block", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {row.fullName}
                </span>
                <span
                  style={{
                    display: "block",
                    fontSize: 11.5,
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
            <span>
              <span
                className="rl-chip rl-chip--role rl-chip--mini"
                style={{ padding: "3px 10px", fontSize: 11 }}
              >
                {ROLE_LABEL[row.role]}
              </span>
            </span>
            <span style={{ color: "var(--color-ink-subtle)", fontSize: 12.5 }}>
              {row.scopeName}
              <span style={{ color: "var(--color-ink-faint)" }}> · {LEVEL_LABEL[row.scopeLevel]}</span>
            </span>
            <HealthDot tone={statusTone(row.status)}>{STATUS_LABEL[row.status]}</HealthDot>
            <button
              type="button"
              onClick={() => setEditing(row)}
              style={{
                border: "none",
                background: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 12,
                fontWeight: 700,
                color: "var(--color-primary)",
                textAlign: "right",
                padding: 0,
              }}
            >
              Manage
            </button>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {list ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="rl-num" style={{ fontSize: 12, color: "var(--color-ink-subtle)", flex: 1 }}>
            {total === 0 ? "0 people" : `Showing ${fmt(from)}–${fmt(to)} of ${fmt(total)}`}
          </span>
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            style={{
              ...pillButton,
              height: 36,
              border: "1.5px solid var(--color-border)",
              background: "var(--color-card)",
              color: page <= 1 ? "var(--color-ink-faint)" : "var(--color-ink-secondary)",
              cursor: page <= 1 ? "default" : "pointer",
            }}
          >
            ← Previous
          </button>
          <span className="rl-num" style={{ fontSize: 12, fontWeight: 700 }}>
            Page {fmt(page)} of {fmt(lastPage)}
          </span>
          <button
            type="button"
            disabled={page >= lastPage}
            onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
            style={{
              ...pillButton,
              height: 36,
              border: "1.5px solid var(--color-border)",
              background: "var(--color-card)",
              color: page >= lastPage ? "var(--color-ink-faint)" : "var(--color-ink-secondary)",
              cursor: page >= lastPage ? "default" : "pointer",
            }}
          >
            Next →
          </button>
        </div>
      ) : null}

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
    </div>
  );
}

/* ------------------------------ dialogs ------------------------------ */

function DialogFrame({
  label,
  children,
  onClose,
  busy,
}: {
  label: string;
  children: React.ReactNode;
  onClose: () => void;
  busy: boolean;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(12,19,34,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 80,
        padding: 20,
        overflowY: "auto",
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
          width: 420,
          maxWidth: "100%",
          maxHeight: "calc(100dvh - 40px)",
          overflowY: "auto",
        }}
      >
        {children}
      </div>
    </div>
  );
}

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
    <DialogFrame label="Create user" onClose={onClose} busy={busy}>
      <div className="rl-overline">New user</div>
      <h2 style={{ fontSize: 16, fontWeight: 800, marginTop: 6 }}>Create an account</h2>
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
        {scopeLevel ? (
          <p style={{ fontSize: 11.5, color: "var(--color-ink-subtle)", lineHeight: 1.5, margin: 0 }}>
            A {LEVEL_LABEL[scopeLevel].toLowerCase()} scope holds{" "}
            {allowedRoles.map((r) => ROLE_LABEL[r].toLowerCase()).join(", ")} accounts only.
          </p>
        ) : null}
        {error ? <AdminErrorBanner>{error}</AdminErrorBanner> : null}
        {dialogButtons(busy, busy ? "Creating…" : "Create user", onClose)}
      </form>
    </DialogFrame>
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
    <DialogFrame label={`Manage ${target.fullName}`} onClose={onClose} busy={busy}>
      <div className="rl-overline">Manage user</div>
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
    </DialogFrame>
  );
}
