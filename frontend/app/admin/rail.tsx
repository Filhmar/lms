"use client";

/**
 * Admin nav rail — the shipped 72px pattern extended to the admin consoles
 * at desktop (umg-a). Hidden below 1080px (mobile layouts untouched).
 * Icon tooltips on hover/focus; active item primary-tinted; account avatar
 * at the foot. Health keeps its preview badge on its own page.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, Tooltip, type IconName } from "@rl/ui";
import { initialsOf, useSession } from "@/lib/session";

const ITEMS: { href: string; label: string; icon: IconName }[] = [
  { href: "/admin", label: "Admin home", icon: "home" },
  { href: "/admin/users", label: "Users", icon: "users" },
  { href: "/admin/hierarchy", label: "Hierarchy", icon: "tree" },
  { href: "/admin/import", label: "Import users (CSV)", icon: "send" },
  { href: "/admin/credentials", label: "Credentials", icon: "shield" },
  { href: "/admin/health", label: "Send health", icon: "pulse" },
];

export function AdminRail() {
  const pathname = usePathname();
  const { user } = useSession();
  return (
    <nav className="rl-navrail" aria-label="Admin sections">
      <Link href="/admin" className="rl-navrail__logo" aria-label="Resilient-Learn admin home">
        RL
      </Link>
      {ITEMS.map((item) => {
        const active =
          item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
        return (
          <Tooltip key={item.href} label={item.label}>
            <Link
              href={item.href}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              className={`rl-navrail__item${active ? " rl-navrail__item--active" : ""}`}
            >
              <Icon name={item.icon} size={19} />
            </Link>
          </Tooltip>
        );
      })}
      {user ? (
        <span
          className="rl-navrail__foot"
          aria-hidden
          title={user.fullName}
          style={{
            width: 38,
            height: 38,
            borderRadius: "50%",
            background: "var(--color-ink)",
            color: "#fff",
            fontSize: 12,
            fontWeight: 800,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {initialsOf(user.fullName)}
        </span>
      ) : null}
    </nav>
  );
}
