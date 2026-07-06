/**
 * p1e — Admin home (Division tier). Scope breadcrumb + health at a glance.
 * Desktop surface (1040px). The scope breadcrumb encodes the closure-table
 * scope; the padlock marks the admin's own scope boundary.
 */

import Link from "next/link";
import { Chip } from "@rl/ui";
import {
  AdminShell,
  AdminTopBar,
  AdminTopBarCluster,
  Eyebrow,
  HotspotRow,
} from "./ui";

function StatCard({
  eyebrow,
  number,
  numberSuffix,
  footnote,
  footnoteColor,
  warning,
}: {
  eyebrow: string;
  number: string;
  numberSuffix?: string;
  footnote: string;
  footnoteColor?: string;
  warning?: boolean;
}) {
  return (
    <div
      style={{
        background: "var(--color-card)",
        border: warning ? "1.5px solid var(--color-warning-border)" : "1px solid var(--color-border)",
        borderRadius: 14,
        padding: "15px 16px",
      }}
    >
      <Eyebrow color={warning ? "var(--color-on-device-fg)" : undefined}>{eyebrow}</Eyebrow>
      <div
        className="rl-num"
        style={{
          fontSize: 26,
          fontWeight: 800,
          marginTop: 6,
          color: warning ? "var(--color-on-device-fg)" : undefined,
        }}
      >
        {number}
        {numberSuffix ? (
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-ink-subtle)" }}>
            {numberSuffix}
          </span>
        ) : null}
      </div>
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
    </div>
  );
}

const RECENT_IMPORTS = [
  { status: "Running", tone: "sending" as const, file: "SY 2026 enrollment.csv", meta: "1,183/1,240" },
  { status: "Done", tone: "synced" as const, file: "teachers_batch2.csv", meta: "3 errors fixed" },
  { status: "Done", tone: "synced" as const, file: "grade7_sections.csv", meta: "clean" },
];

export default function AdminHomePage() {
  return (
    <AdminShell
      topBar={
        <AdminTopBar
          brand
          ancestors={["Central", "Region IV-A"]}
          current="Division of Cavite"
          note="Your scope"
        >
          <AdminTopBarCluster />
        </AdminTopBar>
      }
    >
      {/* Stat card grid */}
      <div
        style={{
          padding: "20px 22px",
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
        }}
      >
        <StatCard
          eyebrow="Schools reporting today"
          number="214"
          numberSuffix="/230"
          footnote="93% · normal for a Tuesday"
          footnoteColor="var(--color-synced-fg)"
        />
        <StatCard
          eyebrow="Learner work at school"
          number="96.2%"
          footnote="rest is safe on devices, arriving"
        />
        <StatCard
          eyebrow="Imports running"
          number="1"
          footnote="SY 2026 enrollment · 95%"
          footnoteColor="var(--color-primary)"
        />
        <StatCard
          eyebrow="Send-delay hotspots"
          number="3"
          footnote="districts > 24 h behind"
          footnoteColor="var(--color-on-device-fg)"
          warning
        />
      </div>

      {/* Two-panel row */}
      <div
        style={{
          padding: "0 22px 22px",
          display: "grid",
          gridTemplateColumns: "1.2fr 1fr",
          gap: 12,
        }}
      >
        {/* Panel A — hotspots */}
        <div
          style={{
            background: "var(--color-card)",
            border: "1px solid var(--color-border)",
            borderRadius: 14,
            padding: 16,
          }}
        >
          <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 10 }}>
            Where work is arriving slowly
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <HotspotRow
              tone="hotspot"
              text="Maragondon District — 12 schools, last sent 26 h ago"
              actionHref="/admin/hierarchy"
            />
            <HotspotRow
              tone="hotspot"
              text="Ternate District — 8 schools, storm-related outage"
              actionHref="/admin/hierarchy"
            />
            <HotspotRow
              tone="catching-up"
              text="Naic District — catching up, 4 h behind"
              actionHref="/admin/hierarchy"
            />
          </div>
          <p
            style={{
              fontSize: 11.5,
              color: "var(--color-ink-subtle)",
              lineHeight: 1.5,
              marginTop: 10,
            }}
          >
            Slow arrival ≠ lost work. Devices hold everything; these lists help you target
            connectivity help.
          </p>
        </div>

        {/* Panel B — recent imports */}
        <div
          style={{
            background: "var(--color-card)",
            border: "1px solid var(--color-border)",
            borderRadius: 14,
            padding: 16,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 10 }}>Recent imports</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {RECENT_IMPORTS.map((job) => (
              <Link
                key={job.file}
                href="/admin/import/job"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "9px 11px",
                  border: "1px solid var(--color-border)",
                  borderRadius: 10,
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <Chip tone={job.tone} size="mini">
                  {job.status}
                </Chip>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{job.file}</span>
                <span
                  className="rl-num"
                  style={{ fontSize: 11.5, color: "var(--color-ink-subtle)" }}
                >
                  {job.meta}
                </span>
              </Link>
            ))}
          </div>
          <Link
            href="/admin/import"
            style={{
              marginTop: 12,
              height: 42,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1.5px solid var(--color-primary)",
              color: "var(--color-primary)",
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 800,
              textDecoration: "none",
            }}
          >
            + New import
          </Link>
        </div>
      </div>
    </AdminShell>
  );
}
