# UI/UX Design Handoff Prompt — Resilient-Learn DESKTOP views

> **How to use:** paste everything below the divider into Claude (design) —
> ideally in the SAME project that produced the "Calm Shelter" mobile designs,
> so it can reference them. The brief is self-contained either way. Output
> comes back here for implementation against the already-built system.

---

You are designing the **desktop views** for **Resilient-Learn**, the offline-first
PWA LMS for the Philippine Department of Education. A mobile-first design system —
direction 1b **"Calm Shelter"** — already exists and is fully implemented in
production code. This round is an **extension, not a new direction**: proper
desktop layouts, controls, and information density for the same product, reusing
the same tokens, components, state language, and microcopy.

## What already exists (do not redesign — extend)

**Tokens (implemented, verbatim):** Archivo variable 400–800; light: canvas
`#F1F5FB`, card `#FFFFFF`, ink `#17233F`, subtle `#5B6B8C`, border `#DCE4F2`,
primary `#1E4AC2` (tint `#E3EBFA`, pressed `#16389A`, selected `#EFF4FE`); dark:
bg `#0C1322`, card `#131C31`, ink `#E7EDF9`, subtle `#93A3C4`, border `#263352`,
primary `#4D77E8`, tint `#1B2A4E`. Sync states, always shape+color+label:
synced = cloud `#0E6B2E`/`#E7F5EB`, on-device = phone `#8A4E06`/`#FFF4E3`,
sending = up-arrow `#1E4AC2`/`#E3EBFA`, attention = triangle `#AE2A20`/`#FDEBEA`
(dark pairs exist). Type scale 24/19/16/14/12.5 + 10.5 overline (0.08em);
tabular numerals for all counts/timers. Radius 14 card / 999 pill / 10 nested.
Focus ring: 2px primary border + `0 0 0 3px #E3EBFA`. Copy rules: never
"sync/server/error/cache" — say "send to school / your school / what to do
next / on this phone"; counts over adjectives; red only when the user's action
helps; English + Filipino (+30% width allowance).

**Established ≥720dp grammar (already shipped):** 72px left nav rail replaces
the tab bar; exam question palette docks as a rail; Sync Center becomes an
anchored popover; course TOC docks as a 236px rail; permanent identity chip on
shared devices. Desktop designs must feel like the natural continuation of
these patterns.

**Everything below is REAL, working software** (live API, offline engines,
phone-OTP activation, LWW sync, Ed25519 credentials) — you are designing
desktop presentation for functioning features, so every state you draw must
map to a state the system actually has.

## Desktop context (who and where)

- **School computer labs**: budget Windows machines, 1366×768 the floor —
  design at 1366 and 1440, content maxes ~1200px; must not fall apart at 1280.
- **Mouse + keyboard first**: hover states on every interactive element,
  visible focus rings everywhere (the token exists), tooltips on icon-only
  buttons, real keyboard support (specified per screen below). No reliance on
  right-click; dialogs replace bottom sheets; toasts anchor bottom-left above
  no content.
- **Shared machines**: the lab context makes fast, safe account switching and
  the identity chip permanent chrome.
- **Primary desktop users**: admins (all four tiers) and teachers all day;
  students mainly during lab-based exams and reading sessions.
- Touch targets may relax to 32px minimum for pointer-only controls, but keep
  48px on anything students touch in hybrid/tablet labs.

## Screens to design (desktop layouts of implemented surfaces)

**Learner surfaces**
1. **Student home** — dashboard grid (continue-learning, today's exam, courses,
   badges) using the width honestly; nav rail; sync pill in the top bar.
2. **Course reading** — two-pane: docked TOC rail (progress per chapter) +
   reading column (cap measure ~68ch); prefetch/on-device dot grammar kept;
   keyboard: ←/→ pages, `t` toggles TOC.
3. **Exam taking (lab mode — the crown jewel)** — question column + permanently
   docked palette rail + timer/status placement that survives 90 minutes of
   staring; per-answer saved chip; keyboard: 1–4/A–D select, ←/→ navigate,
   `F` flag; the zero-loss reassurance strip; submit + drip-progress states;
   crash-recovery welcome-back at desktop scale.
4. **Sync Center** — anchored popover from the pill + a full-page detail view.
5. **Wallet / badge detail / certificate** — grid of credentials; detail with
   QR + verify URL + OB3 JSON download; certificate print-preview framing.

**Admin surfaces (the biggest wins — currently thin at desktop)**
6. **Admin home** — stat cards, recent imports/jobs, quick actions.
7. **Hierarchy console** — a TRUE tree: expand/collapse with keyboard
   (↑↓←→), search-with-highlight, breadcrumb, right-hand detail panel
   (scope stats, children, create-child action). The scope wall (lateral
   isolation) as a first-class state.
8. **User management** — dense data table: sortable columns (name, role,
   scope, status), sticky header, column of checkboxes → bulk actions bar
   (disable, export CSV), pagination controls, per-row Manage menu, create/edit
   dialogs, filters as a toolbar row; ~20 rows visible at 1366×768.
9. **CSV import** — drag-and-drop dropzone + file picker, template download
   link, instant header validation, first-5-rows preview table, target-scope
   picker, then the job screen: live counts, row-errors table with copy/export,
   job history list.
10. **Credential console** — table + revoke dialog (reason required) + audit
    trail column/panel.
11. **National sync health** — the region-bands/map view at full width with
    drill-down (this is DepEd leadership's screen — make it presentation-grade).

**Public + auth**
12. **Login** at desktop (works-from-cache framing kept) and the two-step
    phone-OTP activation.
13. **Verify portal** desktop (verified / revoked / not-found / rate-limited;
    masked names; print result).

**Explicitly out of scope this round:** teacher authoring (exam/course
builders) — that's a separate product-design round; do not sketch it here.
Do not touch the mobile designs.

## States (each screen defines them at desktop scale)

Online/offline/degraded-session, syncing with counts, attention-with-action,
empty states, skeletons (never spinners), storage/data-saver where relevant,
update-ready banner (never mid-exam), 403 scope wall, rate-limited portal,
revoked credential, pending-activation user rows, job queued/processing/
completed-with-errors.

## Demo data (use exactly this, it matches the seeded system)

Ana Reyes, Grade 8, San Isidro NHS · Dasmariñas District · Division of Cavite ·
Region IV-A; Science 8 · Quarter 2 Periodical (12 items, 30 min, 10/12 graded);
Science 8 course (3 chapters, 12 pages, PAGASA storm-signals page); import
batch 1,240 rows / 1,183 created / 3 errors / 54 skipped ("Row 45 — email is
not valid"); credentials control no. 2026-04-118203, verify codes 8KX2-94QF
(verified) / 8KX2-94QG (revoked); masked name `A** R****`; admin
admin@deped.gov.ph "System Administrator".

## Deliverables

1. **Desktop additions to the design system**: data table (sortable/selectable/
   sticky), tree view, anchored popover, dropdown menu, toolbar/filter row,
   pagination, dropzone, tooltip, bulk-action bar, keyboard-focus specs — all
   in Calm Shelter tokens, light + dark.
2. **High-fidelity desktop screens** for all 13 areas above at 1366, with the
   exam-taking and user-management flows given full state sheets.
3. **Keyboard & pointer spec** — one page: shortcuts per surface, focus order
   rules, hover/active/focus visuals.
4. **Engineer annotations** on every sheet (the previous round's annotation
   style was excellent — keep it).
5. **Microcopy** for any new desktop-only strings (EN + Filipino drafts),
   obeying the existing state language.

Aesthetic bar: calm, institutional, information-dense without clutter — a tool
a division administrator uses for six hours and a Grade 8 student trusts with
a national exam. Nothing in it should feel like a stretched phone app.
