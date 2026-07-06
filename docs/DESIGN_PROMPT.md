# UI/UX Design Handoff Prompt — Resilient-Learn

> **How to use:** paste everything below the divider into Claude (design) as a single
> prompt. It is self-contained — the designer does not need repo access. When the
> design system / screens come back, hand them to the engineering session together
> with [docs/TECHSTACK.md](TECHSTACK.md).

---

You are designing the complete UI/UX for **Resilient-Learn**, an offline-first
Progressive Web App LMS that will replace a failing Moodle deployment for the
Philippine Department of Education (DepEd) at national scale — millions of students,
teachers, and administrators across five organizational levels (Central → Region →
Division → District → School).

## Product thesis (why this app exists)

The current system throws 500/502 errors during exams and loses student work. This
app's entire identity is the opposite: **learning never stops, and nothing is ever
lost** — even with zero connectivity, a dying battery, or a national server outage.
The device is the source of truth during exams; the server merely aggregates. The UI's
emotional job is **trust**: a student in a disconnected rural school must feel, at
every moment, that their work is safe.

Design a system that makes resilience *visible and calming*, not technical. Never use
jargon like "CRDT", "sync queue", "IndexedDB", or "encrypted" in user-facing copy —
say "saved on this device", "sent to school", "ready for offline".

## Platform & technical context (constrains the design)

- Progressive Web App built with Next.js + React + Tailwind; installable to the home
  screen (add-to-home-screen is a **first-class onboarding step**, not a banner —
  installation unlocks offline reliability, especially on iPhone).
- Mobile-first for low-end Android phones (small, low-quality screens, limited
  RAM/CPU); a tablet layout for shared school devices; responsive desktop for admin
  consoles. A future React Native app will reuse this design language.
- Connectivity assumption: intermittent 2G/3G, high latency, hours-to-days-long
  outages. Every screen must define offline behavior. Server errors are intercepted
  and served from local data — the user should never see a blank error page.
- Students pay for mobile data: all downloads are explicit, sizes are shown before
  downloading, and data-saver mode disables prefetching.
- Lightweight DOM, minimal animation (low-end devices + battery), system-adjacent
  type stack or one variable font maximum.

## Personas

1. **Student (primary, largest population).** Takes high-stakes offline exams, reads
   and watches downloaded course content, manages device storage, checks sync status,
   switches between a personal phone and a shared school tablet, views/shares earned
   badges. Wide digital-literacy range, including first-time smartphone users.
2. **Teacher.** Authors courses and exams (multiple choice, true/false, strict
   identification; time limits; shuffling; versioned question banks), monitors which
   students' answers are still trickling in ("3 students' answers still pending"),
   views grades after server-side grading.
3. **School Admin.** Manages users at school scope, runs bulk CSV imports with
   job-progress tracking and row-level error reports, views school dashboards.
4. **District / Division / Region Admins** (three tiers, one UI pattern, scoped
   differently). Manage their sub-tree of the hierarchy, publish content that inherits
   downward, monitor sync-failure hotspots by geography. **Lateral isolation is
   absolute** — Region A must never see Region B, so the current scope must be
   unmistakable at all times (persistent breadcrumb, e.g. *Central › Region IV-A ›
   Division of Cavite › Dasmariñas District › School X*).
5. **Central Admin (DepEd national).** Full hierarchy management, national
   connectivity-health map (where sync is failing nationwide), credential revocation,
   security monitoring.
6. **External Verifier (unauthenticated, one-shot).** An HR officer scans a QR code on
   a certificate and must understand Verified / Revoked / Not Found in seconds, on
   their own phone, with zero explanation.
7. **Shared-device context.** Multiple students on one tablet: fast, safe account
   switching that never mixes one student's saved work with another's.

## Screens to design (grouped by delivery phase)

**Phase I — Foundation**
1. Login (must work from the cached shell with 0% connectivity for returning users;
   define the first-login-requires-connection state).
2. Account activation (bulk-imported users arrive as "pending activation" → welcome
   email → set password → first login).
3. Role-scoped dashboards: student home (my courses, downloads, sync status, upcoming
   exams, badges), teacher home, admin home per tier with scope breadcrumb.
4. Hierarchy console (admins): browse/search the 5-level tree, create/edit scopes,
   view sub-trees, scope switcher.
5. User management: list/search within scope, roles, statuses.
6. Bulk CSV import wizard: upload → immediate structure validation → target-scope
   picker → confirm → instant "job started" (the admin is never left on a spinner).
7. Import job progress: queued → processing (live total/success/failed counts) →
   completed with row-level errors ("row 45: invalid email") and fix-and-retry.

**Phase II — Offline exams (the heart of the product — design these first)**
8. Exam list + exam detail (instructions, time limit, download-for-offline state:
   "Exam downloaded — ready to take offline").
9. Exam download flow with confirmation.
10. Exam-taking screen: one question per screen, thumb-reachable actions, timer,
    question navigator/palette, instant Next (zero network round-trip), per-answer
    "saved" micro-confirmation.
11. Crash-recovery resume: "Welcome back — your 34 answers are safe."
12. Local submit: instant confirmation, no spinner-of-death, honest upload state
    ("Submitted on this device. Sending to school: 12/60 answers sent. You can close
    this app.").
13. Post-exam status: distinct *awaiting upload* vs *awaiting grading* vs *graded*.
14. **Sync Center** (global): persistent cloud indicator in the app chrome —
    green = synced, orange = saved-on-device — expanding to a detail view with pending
    count, per-item status, last-sync time, and manual "sync now".
15. iOS-specific degraded state: uploads only continue while the app is open — design
    the honest prompt ("Keep the app open until upload finishes" / a push notification
    that reopens the app) without alarming the student.

**Phase III — Course player**
16. Course catalog / my courses (scope-inherited, cached offline, per-course download
    state).
17. Course overview / table of contents from chapters → pages, with per-chapter
    download indicators and "content updated — download 2 changed pages" states.
18. Player pages: text/markdown; video (instant scrubbing when downloaded; "not
    available offline — connect to download" state); embedded mini-assessment.
19. Next/Prev navigation with the PRD's prefetch dot on the Next button: gray (not
    ready) / subtle activity (fetching, visible only on slow connections) / green
    check (on device, instant). Encode this state redundantly, not by color alone.
20. Download manager: per-module/video downloads with live progress ("45%"),
    pause/resume, sizes shown before download, "Remove download", storage-usage
    overview with quota warnings and guided cleanup.
21. PWA shell: install onboarding, offline splash, app-update-available refresh prompt.

**Phase IV — Credentials**
22. Student credential wallet: earned badges/certificates; "claim pending sync" state
    (badge becomes official only after server confirmation — needs honest,
    non-alarming copy); badge detail with QR + verification link + share/export.
23. Certificate render with embedded QR (print- and screenshot-friendly).
24. **Public verification portal** (standalone, may have its own lighter visual
    identity): scan result for Verified (masked name "J*** D**", achievement, issuing
    scope, issue date) / Revoked / Not Found / rate-limited. Must load near-instantly
    and be legible to a non-technical HR officer at a glance.
25. Admin credential console: issuance oversight, revocation with confirmation +
    audit trail.
26. Admin observability: regional sync-health map, import/exam dashboards.

## System states every screen must define

Online-synced · offline-with-local-data (fully functional, never an error page) ·
syncing (drip upload in progress) · sync-failed-retrying (escalate to the user only
when their action helps, e.g. "connect to Wi-Fi to finish uploading your exam") ·
download progress/paused/interrupted · downloaded-available-offline · prefetch-ready ·
data-saver active ("pages load when you tap") · storage full · first-run hydration
("setting up your offline library") · cross-device merge applied (silent or a gentle
"progress merged from your other device" — never an error dialog) · token expired
while offline (keep working; re-auth on reconnect without losing anything) · app
update available.

## Non-negotiable UX rules (from the PRD)

1. **3-second rule:** no transition or content load over 3 s on 3G — design for
   skeletons-never-spinners, and prefer instant local rendering.
2. **Sync transparency:** the cloud indicator (green = synced / orange = saved on
   device) is always visible in the app chrome; state is also conveyed by shape/label,
   not color alone (WCAG).
3. **Zero-loss guarantee, communicated:** save confirmations and crash-recovery
   messaging make the guarantee *felt*, not just implemented.
4. **No spinner-of-death anywhere** — exam submit is instant and local; uploads are
   background state, not blocking state.
5. **Respect the pocket:** nothing downloads without explicit consent; sizes visible;
   data-saver honored.
6. **Scope clarity:** persistent breadcrumbs; users always know where they are in the
   hierarchy and why they can see what they see.
7. **Privacy:** the public portal masks names; no email/phone/ID ever appears there.
8. **Accessibility:** WCAG AA; touch targets ≥ 44 px; readable type on poor displays;
   screen-reader-compatible exam taking; reduced-motion support.
9. **Language:** plan for English and Filipino copy (and space for longer regional
   translations); calm, plain-language microcopy throughout — write the actual
   microcopy for sync/offline/exam states, it is part of the deliverable.

## Deliverables requested

1. **Design system:** color palette (including semantic tokens for the sync states —
   synced/offline-saved/failed — that work in light and dark themes), type scale for
   small low-quality screens, spacing, iconography (cloud/sync/download/offline
   family), component library (buttons, cards, list rows, progress, badges, status
   chips, breadcrumb, question navigator, timer, toasts/banners).
2. **High-fidelity mobile flows** for the Phase II exam journey end-to-end (screens
   8–15) — this is the make-or-break flow; include every state.
3. **Key screens** for each remaining phase (mobile-first; tablet/desktop for admin
   consoles and the hierarchy tree).
4. **Microcopy** for all offline/sync/exam states in English (with tone guidance for
   Filipino translation).
5. **A one-page "state language" spec:** how online/offline/syncing/saved/failed are
   expressed consistently across icon, color, shape, and copy everywhere in the app.

Aesthetic direction: clean, calm, institutional-but-friendly — a public-education
tool, not a startup toy. High contrast, generous touch targets, content-first layouts
that feel fast on a ₱4,000 Android phone. The design should make a stressed student
taking a national exam in a brownout feel: *my work is safe*.
