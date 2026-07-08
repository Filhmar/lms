import Link from "next/link";

/** Review index — every implemented screen, grouped by phase.
    "preview" = demo fixtures behind the visible badge (⚙ harness lives
    there); unmarked screens are wired to the real API. */

const GROUPS: {
  title: string;
  links: { href: string; label: string; preview?: boolean }[];
}[] = [
  {
    title: "Phase I — Foundation",
    links: [
      { href: "/login", label: "Login" },
      { href: "/activate", label: "Account activation" },
      { href: "/", label: "Student home", preview: true },
      { href: "/admin", label: "Admin home" },
      { href: "/admin/hierarchy", label: "Hierarchy console" },
      { href: "/admin/users", label: "User management" },
      { href: "/admin/import", label: "CSV import wizard" },
      { href: "/admin/import/job", label: "Import job progress" },
      { href: "/admin/credentials", label: "Admin credential console", preview: true },
      { href: "/admin/health", label: "National sync health", preview: true },
    ],
  },
  {
    title: "Phase II — Exams & sync",
    links: [
      { href: "/exams", label: "Exam journey (interactive)", preview: true },
      { href: "/sync", label: "Sync Center", preview: true },
    ],
  },
  {
    title: "Phase III — Courses & PWA",
    links: [
      { href: "/courses", label: "My courses", preview: true },
      { href: "/courses/science-8", label: "Course TOC", preview: true },
      { href: "/courses/science-8/read", label: "Course player", preview: true },
      { href: "/downloads", label: "Download manager", preview: true },
    ],
  },
  {
    title: "Phase IV — Credentials",
    links: [
      { href: "/wallet", label: "Credential wallet", preview: true },
      { href: "/wallet/science-star", label: "Badge detail", preview: true },
      { href: "/wallet/science-star-q3", label: "Badge detail (revoked)", preview: true },
      { href: "/certificate", label: "Certificate render", preview: true },
      { href: "/verify", label: "Public verification portal", preview: true },
      { href: "/verify/8KX2-94QF", label: "Verify result (verified)", preview: true },
      { href: "/verify/8KX2-94QG", label: "Verify result (revoked)", preview: true },
    ],
  },
];

export default function ScreensIndex() {
  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "36px 20px 64px" }}>
      <h1 className="rl-display">Resilient-Learn — screens</h1>
      <p className="rl-secondary" style={{ marginTop: 6 }}>
        Unmarked screens run on the live API. Screens marked{" "}
        <em style={{ fontStyle: "normal", fontWeight: 700 }}>preview</em> run on demo fixtures — on
        those, the ⚙ harness (bottom right) flips theme, connectivity, iOS mode, and battery
        states.
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
                {link.preview ? (
                  <span
                    style={{
                      marginLeft: 10,
                      display: "inline-flex",
                      alignItems: "center",
                      background: "var(--color-on-device-bg)",
                      color: "var(--color-on-device-fg)",
                      border: "1px dashed var(--color-on-device-solid)",
                      borderRadius: 999,
                      padding: "2px 9px",
                      fontSize: 10.5,
                      fontWeight: 800,
                      flexShrink: 0,
                    }}
                  >
                    preview
                  </span>
                ) : null}
                <span style={{ marginLeft: "auto", color: "var(--color-ink-subtle)" }}>→</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
