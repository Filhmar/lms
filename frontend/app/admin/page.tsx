"use client";

/**
 * p1e — Admin home, wired to the live API. Greeting + scope breadcrumb come
 * from /users/me (session); the stat cards from GET /scopes/:id/stats.
 * Quick links go to the three wired consoles: Users, Hierarchy, Import.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon, type IconName } from "@rl/ui";
import type { ScopeStatsResponse } from "@rl/schemas";
import { apiGet, getErrorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { AdminChrome, AdminErrorBanner, LEVEL_LABEL } from "./chrome";
import { Eyebrow } from "./ui";

const fmt = (n: number) => n.toLocaleString("en-US");

function StatCard({
  eyebrow,
  number,
  footnote,
  footnoteColor,
}: {
  eyebrow: string;
  number: string;
  footnote?: string;
  footnoteColor?: string;
}) {
  return (
    <div
      style={{
        background: "var(--color-card)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        padding: "15px 16px",
      }}
    >
      <Eyebrow>{eyebrow}</Eyebrow>
      <div className="rl-num" style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }}>
        {number}
      </div>
      {footnote ? (
        <div
          style={{
            fontSize: 11.5,
            marginTop: 3,
            color: footnoteColor ?? "var(--color-ink-subtle)",
            fontWeight: footnoteColor ? 600 : 400,
          }}
        >
          {footnote}
        </div>
      ) : null}
    </div>
  );
}

function QuickLink({
  href,
  icon,
  title,
  sub,
}: {
  href: string;
  icon: IconName;
  title: string;
  sub: string;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: "var(--color-card)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        padding: "14px 16px",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <span
        style={{
          width: 40,
          height: 40,
          borderRadius: 11,
          background: "var(--color-primary-tint)",
          color: "var(--color-primary)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icon name={icon} size={19} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 14, fontWeight: 800 }}>{title}</span>
        <span style={{ display: "block", fontSize: 11.5, color: "var(--color-ink-subtle)", marginTop: 1 }}>
          {sub}
        </span>
      </span>
      <span aria-hidden style={{ color: "var(--color-ink-subtle)" }}>
        →
      </span>
    </Link>
  );
}

export default function AdminHomePage() {
  return (
    <AdminChrome brand>
      <AdminHomeBody />
    </AdminChrome>
  );
}

function AdminHomeBody() {
  const { user } = useSession();
  const [stats, setStats] = useState<ScopeStatsResponse | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);

  const scopeId = user?.scopeId;
  useEffect(() => {
    if (!scopeId) return;
    let cancelled = false;
    apiGet<ScopeStatsResponse>(`/scopes/${scopeId}/stats`)
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch((err: unknown) => {
        if (!cancelled) setStatsError(getErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [scopeId]);

  if (!user) return null;
  const firstName = user.fullName.split(/\s+/)[0] ?? user.fullName;
  const hour = new Date().getHours();
  const daypart = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const u = stats?.users;

  return (
    <>
      {/* Greeting */}
      <div style={{ padding: "22px 22px 0" }}>
        <h1 style={{ fontSize: 20, fontWeight: 800 }}>
          Good {daypart}, {firstName}
        </h1>
        <div style={{ fontSize: 12.5, color: "var(--color-ink-subtle)", marginTop: 3 }}>
          {user.scopeName} · {LEVEL_LABEL[user.scopeLevel]} scope — everything below is inside your
          scope only.
        </div>
      </div>

      {statsError ? (
        <div style={{ padding: "14px 22px 0" }}>
          <AdminErrorBanner>{statsError}</AdminErrorBanner>
        </div>
      ) : null}

      {/* Stat card grid — live counts from /scopes/:id/stats */}
      <div
        style={{
          padding: "16px 22px 0",
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
        }}
      >
        <StatCard
          eyebrow="Users in your scope"
          number={u ? fmt(u.total) : "—"}
          footnote={u ? `${fmt(u.active)} active · ${fmt(u.disabled)} disabled` : "counting…"}
          footnoteColor={u ? "var(--color-synced-fg)" : undefined}
        />
        <StatCard
          eyebrow="Pending activation"
          number={u ? fmt(u.pendingActivation) : "—"}
          footnote={u ? "waiting to set a password" : "counting…"}
          footnoteColor={u && u.pendingActivation > 0 ? "var(--color-on-device-fg)" : undefined}
        />
        <StatCard
          eyebrow="Students · Teachers"
          number={u ? `${fmt(u.students)} · ${fmt(u.teachers)}` : "—"}
          footnote={u ? "across the whole subtree" : "counting…"}
        />
        <StatCard
          eyebrow="Child scopes"
          number={stats ? fmt(stats.childScopes) : "—"}
          footnote={stats ? `directly under ${user.scopeName}` : "counting…"}
        />
      </div>

      {/* Quick links */}
      <div
        style={{
          padding: "16px 22px 22px",
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 12,
        }}
      >
        <QuickLink
          href="/admin/users"
          icon="course"
          title="Users"
          sub="Search, create, and manage accounts"
        />
        <QuickLink
          href="/admin/hierarchy"
          icon="navigator"
          title="Hierarchy"
          sub="Browse your scopes, add new ones"
        />
        <QuickLink
          href="/admin/import"
          icon="send"
          title="Import"
          sub="Bulk-create users from a CSV"
        />
      </div>
    </>
  );
}
