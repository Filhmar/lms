"use client";

/**
 * Real admin chrome — session-driven top bar (scope breadcrumb from
 * /users/me with the lock note, staff initials, Log out) wrapped in the
 * RequireAdmin gate. Used by every wired Phase I admin surface; preview
 * consoles (credentials/health) keep their fixture chrome.
 */

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Icon, SyncPill } from "@rl/ui";
import type { ApiError as ApiErrorType } from "@/lib/api";
import { ApiError, apiGet } from "@/lib/api";
import type { SubtreeResponse, ScopeWithDepth } from "@rl/schemas";
import { initialsOf, RequireAdmin, useSession } from "@/lib/session";
import { AdminShell, AdminTopBar } from "./ui";

export function AdminChrome({
  brand,
  title,
  note = "Your scope",
  barExtra,
  children,
}: {
  brand?: boolean;
  title?: string;
  note?: string;
  barExtra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <RequireAdmin>
      <AdminChromeInner brand={brand} title={title} note={note} barExtra={barExtra}>
        {children}
      </AdminChromeInner>
    </RequireAdmin>
  );
}

function AdminChromeInner({
  brand,
  title,
  note,
  barExtra,
  children,
}: {
  brand?: boolean;
  title?: string;
  note?: string;
  barExtra?: ReactNode;
  children: ReactNode;
}) {
  const { user, breadcrumb, logout } = useSession();
  const router = useRouter();
  if (!user) return null; // RequireAdmin guarantees this in practice

  const chain = breadcrumb ?? [];
  const ancestors = chain.slice(0, -1).map((s) => s.name);
  const current = chain.length > 0 ? chain[chain.length - 1]!.name : user.scopeName;

  return (
    <AdminShell
      topBar={
        <AdminTopBar brand={brand} title={title} ancestors={ancestors} current={current} note={note}>
          {barExtra}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
            <SyncPill state="synced" label="Live" />
            <span
              aria-hidden
              title={user.fullName}
              style={{
                width: 34,
                height: 34,
                borderRadius: "50%",
                background: "var(--color-ink)",
                color: "#ffffff",
                fontSize: 12,
                fontWeight: 800,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {initialsOf(user.fullName)}
            </span>
            <button
              type="button"
              onClick={() => {
                void logout().then(() => router.replace("/login"));
              }}
              style={{
                height: 36,
                padding: "0 14px",
                border: "1.5px solid var(--color-border)",
                borderRadius: 999,
                background: "var(--color-card)",
                color: "var(--color-ink-secondary)",
                fontSize: 12,
                fontWeight: 800,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Log out
            </button>
          </div>
        </AdminTopBar>
      }
    >
      {children}
    </AdminShell>
  );
}

/* --------------------------- Shared data hooks --------------------------- */

/** Loads GET /scopes/:id/subtree — the flat closure list under a scope. */
export function useSubtree(scopeId: string | null | undefined) {
  const [scopes, setScopes] = useState<ScopeWithDepth[] | null>(null);
  const [error, setError] = useState<ApiErrorType | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!scopeId) return;
    let cancelled = false;
    setError(null);
    apiGet<SubtreeResponse>(`/scopes/${scopeId}/subtree`)
      .then((res) => {
        if (!cancelled) setScopes(res.scopes);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err : new ApiError(0, "No connection right now."));
      });
    return () => {
      cancelled = true;
    };
  }, [scopeId, nonce]);

  return { scopes, error, reload: () => setNonce((n) => n + 1) };
}

/** Design-system <select> used by scope/role/status pickers. */
export function AdminSelect({
  label,
  value,
  onChange,
  children,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
      <span className="rl-label" style={{ margin: 0 }}>
        {label}
      </span>
      <select
        className="rl-input"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={{ height: 44, fontFamily: "inherit", fontSize: 13 }}
      >
        {children}
      </select>
    </label>
  );
}

/** Scope picker over a subtree — grouped by level, ordered by depth. */
export function ScopeSelect({
  label,
  scopes,
  value,
  onChange,
  disabled,
}: {
  label: string;
  scopes: ScopeWithDepth[] | null;
  value: string;
  onChange: (scopeId: string) => void;
  disabled?: boolean;
}) {
  const levels: ScopeWithDepth["level"][] = ["central", "region", "division", "district", "school"];
  return (
    <AdminSelect label={label} value={value} onChange={onChange} disabled={disabled || !scopes}>
      {!scopes ? <option value={value}>Loading your scopes…</option> : null}
      {scopes
        ? levels
            .map((level) => ({
              level,
              items: scopes
                .filter((s) => s.level === level)
                .sort((a, b) => a.name.localeCompare(b.name)),
            }))
            .filter((g) => g.items.length > 0)
            .map((g) => (
              <optgroup key={g.level} label={LEVEL_LABEL[g.level]}>
                {g.items.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            ))
        : null}
    </AdminSelect>
  );
}

export const LEVEL_LABEL: Record<ScopeWithDepth["level"], string> = {
  central: "Central",
  region: "Region",
  division: "Division",
  district: "District",
  school: "School",
};

/** Inline attention banner for surfacing backend messages on admin surfaces. */
export function AdminErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      style={{
        background: "var(--color-attention-bg)",
        border: "1.5px solid var(--color-danger-border)",
        borderRadius: 12,
        padding: "10px 13px",
        fontSize: 12.5,
        fontWeight: 600,
        lineHeight: 1.5,
        color: "var(--color-attention-fg)",
      }}
    >
      {children}
    </div>
  );
}

/** The designed "scope wall" — rendered whenever the API answers 403. */
export function ScopeWall({ message, onBack }: { message?: string; onBack?: () => void }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "56px 22px" }}>
      <div
        style={{
          background: "var(--color-card)",
          border: "1.5px solid var(--color-border)",
          borderRadius: 16,
          padding: "24px 18px",
          textAlign: "center",
          width: 380,
        }}
      >
        <div
          style={{
            width: 58,
            height: 58,
            borderRadius: "50%",
            background: "var(--color-canvas)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto",
            color: "var(--color-ink-subtle)",
          }}
        >
          <Icon name="lock" size={26} />
        </div>
        <h2 style={{ fontSize: 16, fontWeight: 800, marginTop: 11 }}>Outside your scope</h2>
        <p style={{ fontSize: 12.5, color: "var(--color-ink-subtle)", lineHeight: 1.55, marginTop: 6 }}>
          {message ?? "That page belongs to another scope. Your account covers your own scope only."}
        </p>
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            style={{
              height: 42,
              marginTop: 14,
              background: "var(--color-primary)",
              color: "#ffffff",
              border: "none",
              borderRadius: 999,
              padding: "0 18px",
              fontSize: 12.5,
              fontWeight: 800,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Back to your scope
          </button>
        ) : null}
        <p style={{ fontSize: 10.5, color: "var(--color-ink-faint)", marginTop: 10 }}>
          Need wider access? Ask the admin one level above you.
        </p>
      </div>
    </div>
  );
}
