import Link from "next/link";

/** Review index — every implemented screen, grouped by phase. */

const GROUPS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Phase I — Foundation",
    links: [
      { href: "/login", label: "Login" },
      { href: "/activate", label: "Account activation" },
      { href: "/", label: "Student home" },
      { href: "/admin", label: "Admin home (Division)" },
      { href: "/admin/hierarchy", label: "Hierarchy console" },
      { href: "/admin/import", label: "CSV import wizard" },
      { href: "/admin/import/job", label: "Import job progress" },
      { href: "/admin/credentials", label: "Admin credential console" },
      { href: "/admin/health", label: "National sync health" },
    ],
  },
  {
    title: "Phase II — Exams & sync",
    links: [
      { href: "/exams", label: "Exam journey (interactive)" },
      { href: "/sync", label: "Sync Center" },
    ],
  },
  {
    title: "Phase III — Courses & PWA",
    links: [
      { href: "/courses", label: "My courses" },
      { href: "/courses/science-8", label: "Course TOC" },
      { href: "/courses/science-8/read", label: "Course player" },
      { href: "/downloads", label: "Download manager" },
    ],
  },
  {
    title: "Phase IV — Credentials",
    links: [
      { href: "/wallet", label: "Credential wallet" },
      { href: "/wallet/science-star", label: "Badge detail" },
      { href: "/wallet/science-star-q3", label: "Badge detail (revoked)" },
      { href: "/certificate", label: "Certificate render" },
      { href: "/verify", label: "Public verification portal" },
      { href: "/verify/8KX2-94QF", label: "Verify result (verified)" },
      { href: "/verify/8KX2-94QG", label: "Verify result (revoked)" },
    ],
  },
];

export default function ScreensIndex() {
  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "36px 20px 64px" }}>
      <h1 className="rl-display">Resilient-Learn — screens</h1>
      <p className="rl-secondary" style={{ marginTop: 6 }}>
        Implementation of the Calm Shelter design. Use the ⚙ harness (bottom
        right) to flip theme, connectivity, iOS mode, and battery states.
      </p>
      {GROUPS.map((group) => (
        <section key={group.title} style={{ marginTop: 28 }}>
          <div className="rl-overline" style={{ marginBottom: 10 }}>
            {group.title}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {group.links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rl-row"
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <span className="rl-row__title">{link.label}</span>
                <span style={{ marginLeft: "auto", color: "var(--color-ink-subtle)" }}>→</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
