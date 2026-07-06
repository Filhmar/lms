"use client";

/**
 * p1f + d7a–d7c — Hierarchy console. 5-level tree browse/search, scope
 * detail with users/schools tabs, the scope wall (lateral isolation) and
 * the empty-scope state. Desktop admin surface (1040px).
 *
 * Isolation is a first-class cue: ancestors render grayed with a padlock
 * (visible for orientation, never clickable); sibling divisions don't
 * exist in the payload at all; deep links outside the scope hit the wall.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { Chip, Icon } from "@rl/ui";
import { AdminShell, AdminTopBar, Eyebrow, HealthDot } from "../ui";

/* ------------------------------------------------------------------ */
/* Demo data — Division of Cavite subtree only (siblings never ship). */
/* ------------------------------------------------------------------ */

interface SchoolRow {
  id: string;
  name: string;
  learners: string;
  lastSent: string;
  health: "fresh" | "lagging";
  content: string;
}

interface UserRow {
  name: string;
  school: string;
  role: "Student" | "Teacher";
  status: "Active" | "Pending activation";
}

interface District {
  id: string;
  name: string;
  schools: number;
  learners: string;
  staff: string;
  admin: string;
  moreSchools: number;
  schoolRows: SchoolRow[];
  users: UserRow[];
}

const DISTRICTS: District[] = [
  {
    id: "dasma",
    name: "Dasmariñas District",
    schools: 31,
    learners: "41,208",
    staff: "1,882",
    admin: "R. Cruz",
    moreSchools: 28,
    schoolRows: [
      { id: "san-isidro", name: "San Isidro National HS", learners: "2,140", lastSent: "1 h ago", health: "fresh", content: "inherits ✓" },
      { id: "salawag", name: "Salawag Integrated School", learners: "1,384", lastSent: "26 h ago", health: "lagging", content: "inherits ✓" },
      { id: "dasma-east", name: "Dasmariñas East ES", learners: "960", lastSent: "3 h ago", health: "fresh", content: "+2 local courses" },
    ],
    users: [
      { name: "Ana Reyes", school: "San Isidro NHS", role: "Student", status: "Active" },
      { name: "Rodel Santos", school: "San Isidro NHS", role: "Teacher", status: "Active" },
      { name: "Joel Dizon", school: "Salawag IS", role: "Student", status: "Pending activation" },
    ],
  },
  {
    id: "imus",
    name: "Imus District",
    schools: 44,
    learners: "56,113",
    staff: "2,406",
    admin: "L. Mendoza",
    moreSchools: 42,
    schoolRows: [
      { id: "imus-pilot", name: "Imus Pilot ES", learners: "1,904", lastSent: "2 h ago", health: "fresh", content: "inherits ✓" },
      { id: "gen-topacio", name: "Gen. Topacio NHS", learners: "2,388", lastSent: "5 h ago", health: "fresh", content: "inherits ✓" },
    ],
    users: [
      { name: "Marites Cruz", school: "Imus Pilot ES", role: "Teacher", status: "Active" },
      { name: "Ben Alonzo", school: "Gen. Topacio NHS", role: "Student", status: "Active" },
    ],
  },
  {
    id: "bacoor",
    name: "Bacoor District",
    schools: 38,
    learners: "49,760",
    staff: "2,150",
    admin: "P. Aguinaldo",
    moreSchools: 36,
    schoolRows: [
      { id: "bacoor-nhs", name: "Bacoor National HS", learners: "3,012", lastSent: "1 h ago", health: "fresh", content: "inherits ✓" },
      { id: "molino-es", name: "Molino ES", learners: "1,540", lastSent: "22 h ago", health: "lagging", content: "inherits ✓" },
    ],
    users: [
      { name: "Liza Navarro", school: "Bacoor National HS", role: "Student", status: "Pending activation" },
      { name: "Edwin Salazar", school: "Molino ES", role: "Teacher", status: "Active" },
    ],
  },
  {
    id: "ternate",
    name: "Ternate District",
    schools: 0,
    learners: "0",
    staff: "0",
    admin: "—",
    moreSchools: 0,
    schoolRows: [],
    users: [],
  },
];

const TABS = ["Users", "Schools", "Published content", "Send health"] as const;
type Tab = (typeof TABS)[number];

/* ------------------------------------------------------------------ */

const treeRowBase = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  padding: "8px 10px",
  borderRadius: 9,
  fontSize: 13,
  fontWeight: 600,
  width: "100%",
  textAlign: "left" as const,
  border: "none",
  background: "none",
  fontFamily: "inherit",
};

function LockedTreeRow({ indent, children }: { indent: number; children: string }) {
  return (
    <div style={{ ...treeRowBase, paddingLeft: indent, color: "var(--color-ink-faint)" }}>
      <Icon name="lock" size={11} />
      {children}
    </div>
  );
}

function tableHeaderStyle(columns: string): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: columns,
    padding: "10px 16px",
    fontSize: 10.5,
    fontWeight: 800,
    letterSpacing: "0.06em",
    color: "var(--color-ink-subtle)",
    borderBottom: "1.5px solid var(--color-border)",
    textTransform: "uppercase",
  };
}

function tableRowStyle(columns: string, last: boolean): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: columns,
    alignItems: "center",
    padding: "11px 16px",
    fontSize: 13,
    borderBottom: last ? "none" : "1px solid var(--color-divider)",
  };
}

export default function HierarchyPage() {
  const [selectedDistrict, setSelectedDistrict] = useState("dasma");
  const [selectedSchool, setSelectedSchool] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ dasma: true });
  const [tab, setTab] = useState<Tab>("Users");
  const [query, setQuery] = useState("");
  const [wall, setWall] = useState(false);

  const district = DISTRICTS.find((d) => d.id === selectedDistrict) ?? DISTRICTS[0]!;
  const school = selectedSchool
    ? district.schoolRows.find((s) => s.id === selectedSchool) ?? null
    : null;

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return null;
    return DISTRICTS.map((d) => ({
      district: d,
      districtHit: d.name.toLowerCase().includes(q),
      schoolHits: d.schoolRows.filter((s) => s.name.toLowerCase().includes(q)),
    })).filter((m) => m.districtHit || m.schoolHits.length > 0);
  }, [q]);
  const matchCount = matches
    ? matches.reduce((n, m) => n + m.schoolHits.length + (m.districtHit ? 1 : 0), 0)
    : 0;

  function pickDistrict(id: string) {
    setSelectedDistrict(id);
    setSelectedSchool(null);
    setExpanded((e) => ({ ...e, [id]: !(e[id] && selectedDistrict === id) }));
  }

  const columnsUsers = "2fr 1.6fr 1fr 1fr 0.8fr";
  const columnsSchools = "2fr 1fr 1fr 1fr";

  return (
    <AdminShell
      topBar={
        <AdminTopBar
          title="Hierarchy"
          ancestors={["Central", "Region IV-A", "Division of Cavite"]}
          current={school ? school.name : district.name}
          note="Your scope — you can't see other divisions"
        >
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search within your division…"
            aria-label="Search within your division"
            style={{
              marginLeft: "auto",
              height: 40,
              border: "1.5px solid var(--color-border)",
              borderRadius: 999,
              padding: "0 15px",
              fontSize: 12.5,
              background: "var(--color-card)",
              color: "var(--color-ink)",
              width: 250,
              fontFamily: "inherit",
            }}
          />
        </AdminTopBar>
      }
    >
      {wall ? (
        /* ---------- The wall — following a link outside your scope ---------- */
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
            <p
              style={{
                fontSize: 12.5,
                color: "var(--color-ink-subtle)",
                lineHeight: 1.55,
                marginTop: 6,
              }}
            >
              This page belongs to{" "}
              <strong style={{ color: "var(--color-ink)" }}>Division of Laguna</strong>. Your
              account covers the Division of Cavite only.
            </p>
            <button
              type="button"
              onClick={() => setWall(false)}
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
              Back to your division
            </button>
            <p style={{ fontSize: 10.5, color: "var(--color-ink-faint)", marginTop: 10 }}>
              Need cross-division access? That&rsquo;s a Region IV-A request.
            </p>
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "320px 1fr" }}>
          {/* ---------------- Left rail — the tree ---------------- */}
          <div
            style={{
              borderRight: "1px solid var(--color-border)",
              padding: "16px 14px",
              background: "var(--color-card)",
              minHeight: 520,
            }}
          >
            <Eyebrow style={{ marginBottom: 10 }}>Your tree</Eyebrow>

            {q && matches && matches.length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--color-ink-subtle)", lineHeight: 1.55, padding: "0 4px" }}>
                No matches inside Division of Cavite. Results never include other divisions.
              </p>
            ) : (
              <div role="tree" aria-label="Scope tree" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {q ? (
                  <div style={{ fontSize: 11.5, color: "var(--color-ink-subtle)", padding: "0 4px 8px" }}>
                    {matchCount} match{matchCount === 1 ? "" : "es"} in your division
                  </div>
                ) : null}
                <LockedTreeRow indent={10}>Central · DepEd</LockedTreeRow>
                <LockedTreeRow indent={24}>Region IV-A · CALABARZON</LockedTreeRow>
                <div style={{ ...treeRowBase, paddingLeft: 38, color: "var(--color-ink-secondary)" }}>
                  ▾ Division of Cavite
                  <span style={{ fontSize: 10.5, color: "var(--color-ink-faint)" }}>· you</span>
                </div>

                {(matches
                  ? matches.map((m) => m.district)
                  : DISTRICTS
                ).map((d) => {
                  const isSelected = d.id === selectedDistrict && !selectedSchool;
                  const isExpanded = q ? true : !!expanded[d.id];
                  const shownSchools = q
                    ? matches?.find((m) => m.district.id === d.id)?.schoolHits ?? []
                    : d.schoolRows;
                  return (
                    <div key={d.id} role="treeitem" aria-expanded={isExpanded} aria-selected={isSelected}>
                      <button
                        type="button"
                        onClick={() => pickDistrict(d.id)}
                        style={{
                          ...treeRowBase,
                          padding: "9px 10px 9px 52px",
                          cursor: "pointer",
                          background: isSelected ? "var(--color-primary-tint)" : "none",
                          color: isSelected ? "var(--color-primary)" : "var(--color-ink-secondary)",
                        }}
                      >
                        <span style={{ flex: 1 }}>
                          {isExpanded ? "▾" : "▸"} {d.name}
                        </span>
                        {isSelected ? (
                          <span
                            className="rl-num"
                            style={{
                              fontSize: 10.5,
                              background: "var(--color-card)",
                              borderRadius: 999,
                              padding: "2px 8px",
                            }}
                          >
                            {d.schools} schools
                          </span>
                        ) : (
                          <span className="rl-num" style={{ fontSize: 10.5, color: "var(--color-ink-faint)" }}>
                            · {d.schools}
                          </span>
                        )}
                      </button>
                      {isExpanded
                        ? shownSchools.map((s) => {
                            const schoolSelected = selectedSchool === s.id && selectedDistrict === d.id;
                            return (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => {
                                  setSelectedDistrict(d.id);
                                  setSelectedSchool(s.id);
                                }}
                                style={{
                                  ...treeRowBase,
                                  paddingLeft: 68,
                                  cursor: "pointer",
                                  background: schoolSelected ? "var(--color-primary-tint)" : "none",
                                  color: schoolSelected
                                    ? "var(--color-primary)"
                                    : "var(--color-ink-secondary)",
                                }}
                              >
                                {s.name}
                              </button>
                            );
                          })
                        : null}
                      {isExpanded && !q && d.moreSchools > 0 ? (
                        <div
                          style={{
                            ...treeRowBase,
                            paddingLeft: 68,
                            fontSize: 12,
                            color: "var(--color-primary)",
                          }}
                        >
                          Show {d.moreSchools} more…
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
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
              Other divisions and regions are never visible from here.
            </div>
            <button
              type="button"
              onClick={() => setWall(true)}
              style={{
                border: "none",
                background: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 11,
                color: "var(--color-ink-faint)",
                textDecoration: "underline",
                padding: "10px 4px 0",
              }}
            >
              Demo: open a deep link outside your scope →
            </button>
          </div>

          {/* ---------------- Right pane — scope detail ---------------- */}
          <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
            {district.schools === 0 && !school ? (
              /* Brand-new scope — empty, with the first step */
              <div style={{ display: "flex", justifyContent: "center", paddingTop: 40 }}>
                <div
                  style={{
                    background: "var(--color-card)",
                    border: "1.5px solid var(--color-border)",
                    borderRadius: 16,
                    padding: "22px 18px",
                    textAlign: "center",
                    width: 400,
                  }}
                >
                  <h2 style={{ fontSize: 15, fontWeight: 800 }}>
                    {district.name} has no schools yet
                  </h2>
                  <p
                    style={{
                      fontSize: 12,
                      color: "var(--color-ink-subtle)",
                      lineHeight: 1.55,
                      marginTop: 5,
                    }}
                  >
                    Add schools one by one, or import the whole roster from the division CSV.
                  </p>
                  <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 13 }}>
                    <button
                      type="button"
                      style={{
                        height: 40,
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
                      + Add first school
                    </button>
                    <Link
                      href="/admin/import"
                      style={{
                        height: 40,
                        padding: "0 15px",
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 800,
                        border: "1.5px solid var(--color-border)",
                        color: "var(--color-ink-secondary)",
                        background: "var(--color-card)",
                        display: "inline-flex",
                        alignItems: "center",
                        textDecoration: "none",
                      }}
                    >
                      Import CSV
                    </Link>
                  </div>
                </div>
              </div>
            ) : school ? (
              /* School detail (level 5) */
              <>
                <div>
                  <button
                    type="button"
                    onClick={() => setSelectedSchool(null)}
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
                    ← Back to {district.name}
                  </button>
                  <h2 style={{ fontSize: 18, fontWeight: 800, marginTop: 8 }}>{school.name}</h2>
                  <div style={{ fontSize: 12, color: "var(--color-ink-subtle)", marginTop: 2 }}>
                    {school.learners} learners · part of {district.name}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                  <HealthDot tone={school.health}>{"sent " + school.lastSent}</HealthDot>
                  <span style={{ fontSize: 12, color: "var(--color-ink-subtle)" }}>{school.content}</span>
                </div>
                <div
                  style={{
                    background: "var(--color-card)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 14,
                    padding: "12px 14px",
                    fontSize: 11.5,
                    lineHeight: 1.5,
                    color: "var(--color-ink-subtle)",
                  }}
                >
                  Content owned by Division of Cavite and Dasmariñas District is visible here
                  automatically — downward inheritance. Work sent by this school rolls up to the
                  district&rsquo;s send health.
                </div>
              </>
            ) : (
              /* District detail (p1f) */
              <>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <h2 style={{ fontSize: 18, fontWeight: 800 }}>{district.name}</h2>
                    <div style={{ fontSize: 12, color: "var(--color-ink-subtle)", marginTop: 2 }}>
                      {district.schools} schools · {district.learners} learners · {district.staff}{" "}
                      staff · district admin: {district.admin}
                    </div>
                  </div>
                  <button
                    type="button"
                    style={{
                      height: 40,
                      padding: "0 16px",
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
                    + Add school
                  </button>
                  <Link
                    href="/admin/import"
                    style={{
                      height: 40,
                      padding: "0 16px",
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

                {/* Tab chips */}
                <div style={{ display: "flex", gap: 8 }}>
                  {TABS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTab(t)}
                      aria-pressed={tab === t}
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        padding: "7px 14px",
                        borderRadius: 999,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        background: tab === t ? "var(--color-primary-tint)" : "var(--color-card)",
                        color: tab === t ? "var(--color-primary)" : "var(--color-ink-subtle)",
                        border: tab === t ? "1px solid transparent" : "1px solid var(--color-border)",
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                {tab === "Users" ? (
                  <div
                    style={{
                      background: "var(--color-card)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 14,
                      overflow: "hidden",
                    }}
                  >
                    <div style={tableHeaderStyle(columnsUsers)}>
                      <span>Name</span>
                      <span>School</span>
                      <span>Role</span>
                      <span>Status</span>
                      <span />
                    </div>
                    {district.users.map((u, i) => (
                      <div key={u.name} style={tableRowStyle(columnsUsers, i === district.users.length - 1)}>
                        <span style={{ fontWeight: 600 }}>{u.name}</span>
                        <span style={{ color: "var(--color-ink-subtle)" }}>{u.school}</span>
                        <span>
                          <Chip tone={u.role === "Teacher" ? "synced" : "role"} size="mini" style={{ padding: "3px 10px", fontSize: 11 }}>
                            {u.role}
                          </Chip>
                        </span>
                        <HealthDot tone={u.status === "Active" ? "fresh" : "lagging"}>
                          {u.status}
                        </HealthDot>
                        <button
                          type="button"
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
                          {u.status === "Pending activation" ? "Resend invite" : "Manage"}
                        </button>
                      </div>
                    ))}
                    {district.users.length === 0 ? (
                      <div style={{ padding: "14px 16px", fontSize: 12.5, color: "var(--color-ink-subtle)" }}>
                        No users in this scope yet — import a CSV to create them.
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {tab === "Schools" || tab === "Send health" ? (
                  <div
                    style={{
                      background: "var(--color-card)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 14,
                      overflow: "hidden",
                    }}
                  >
                    <div style={tableHeaderStyle(columnsSchools)}>
                      <span>School</span>
                      <span>Learners</span>
                      <span>Last sent</span>
                      <span>Content</span>
                    </div>
                    {district.schoolRows.map((s, i) => (
                      <div key={s.id} style={tableRowStyle(columnsSchools, i === district.schoolRows.length - 1)}>
                        <span style={{ fontWeight: 600 }}>{s.name}</span>
                        <span className="rl-num" style={{ color: "var(--color-ink-subtle)" }}>
                          {s.learners}
                        </span>
                        <HealthDot tone={s.health}>{s.lastSent}</HealthDot>
                        <span
                          style={{
                            fontSize: 12,
                            color: "var(--color-ink-subtle)",
                            fontWeight: s.content.startsWith("+") ? 700 : 400,
                          }}
                        >
                          {s.content}
                        </span>
                      </div>
                    ))}
                    {tab === "Send health" ? (
                      <div
                        style={{
                          padding: "11px 16px",
                          fontSize: 11.5,
                          color: "var(--color-ink-subtle)",
                          borderTop: "1px solid var(--color-divider)",
                          lineHeight: 1.5,
                        }}
                      >
                        District-level slice of the national map — slow arrival ≠ lost work; devices
                        hold everything.{" "}
                        <Link href="/admin/health" style={{ color: "var(--color-primary)", fontWeight: 700, textDecoration: "none" }}>
                          Nationwide view →
                        </Link>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {tab === "Published content" ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div
                      style={{
                        background: "var(--color-card)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 10,
                        padding: "10px 12px",
                        fontSize: 13,
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>Inherited from Division of Cavite</span>
                      <span style={{ color: "var(--color-ink-subtle)" }}> — Science 8, Math 8, Filipino 8 + 9 more</span>
                    </div>
                    <div
                      style={{
                        background: "var(--color-card)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 10,
                        padding: "10px 12px",
                        fontSize: 13,
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>Local to this district</span>
                      <span style={{ color: "var(--color-ink-subtle)" }}> — 2 courses · Dasmariñas East ES</span>
                    </div>
                    <p style={{ fontSize: 11.5, color: "var(--color-ink-subtle)", lineHeight: 1.5, marginTop: 2 }}>
                      Downward inheritance: content owned by an ancestor scope is visible to every
                      school below it. &quot;+n local courses&quot; flags divergence at a glance.
                    </p>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      )}
    </AdminShell>
  );
}
