"use client";

/**
 * Learner app chrome: header (avatar + greeting/title + sync pill) and the
 * 4-tab bar (Home · Courses · Exams · Badges). At ≥720dp the tab bar becomes
 * a left nav rail (single breakpoint fork per the deep-dive spec).
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@rl/ui";
import { student } from "@/lib/fixtures";

const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Home", icon: "course" },
  { href: "/courses", label: "Courses", icon: "navigator" },
  { href: "/exams", label: "Exams", icon: "clock" },
  { href: "/wallet", label: "Badges", icon: "qr" },
];

export function AppHeader({
  greeting,
  sub,
  trailing,
}: {
  greeting: ReactNode;
  sub?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 16px 4px" }}>
      <div className="rl-avatar" style={{ fontSize: 14 }}>{student.initials}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 800 }}>{greeting}</div>
        {sub ? (
          <div style={{ fontSize: 11.5, color: "var(--color-ink-subtle)" }}>{sub}</div>
        ) : null}
      </div>
      {trailing}
    </header>
  );
}

export function TabBar({ examBadge }: { examBadge?: number }) {
  const pathname = usePathname();
  return (
    <nav className="app-tabbar" aria-label="Main">
      {TABS.map((tab) => {
        const active =
          tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className="app-tab"
            aria-current={active ? "page" : undefined}
            style={{
              color: active ? "var(--color-primary)" : "var(--color-ink-subtle)",
              fontWeight: active ? 800 : 700,
            }}
          >
            <span style={{ position: "relative", display: "inline-flex" }}>
              <Icon name={tab.icon} size={19} />
              {tab.href === "/exams" && examBadge ? (
                <span className="app-tab__badge">{examBadge}</span>
              ) : null}
            </span>
            <span style={{ fontSize: 10 }}>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** Page shell for learner surfaces: content scrolls, tab bar pinned. */
export function AppShell({ children, examBadge }: { children: ReactNode; examBadge?: number }) {
  return (
    <div className="app-shell">
      <div className="app-shell__content">{children}</div>
      <TabBar examBadge={examBadge} />
    </div>
  );
}
