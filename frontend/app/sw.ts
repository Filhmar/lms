/**
 * Resilient-Learn service worker (injectManifest style, built by
 * @serwist/turbopack via app/serwist/[path]/route.ts).
 *
 * Strategy map (docs/TECHSTACK.md + CLAUDE.md "Service worker strategies"):
 * - Build assets + public/ files: precached (self.__SW_MANIFEST).
 * - /api/v1/* (and the JWKS proxy): NetworkOnly — the app layer owns offline
 *   UX; the SW must never cache auth/user data at this stage.
 * - Static assets (script/style/font/image): Serwist defaultCache
 *   (StaleWhileRevalidate / CacheFirst per asset class).
 * - Navigations: NetworkFirst (defaultCache "pages"), and when the network
 *   and page cache both miss, the precached /offline page answers any
 *   document request (`fallbacks` below).
 * - Updates are learner-controlled: `skipWaiting: false` keeps a new worker
 *   waiting until the update banner posts SKIP_WAITING ("Refresh now") —
 *   never yank precached chunks out from under an open exam.
 */

import { defaultCache } from "@serwist/turbopack/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NetworkOnly, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: false, // waiting worker activates only via SKIP_WAITING message
  clientsClaim: true,
  navigationPreload: true,
  precacheOptions: {
    cleanupOutdatedCaches: true,
    concurrency: 10,
  },
  runtimeCaching: [
    {
      // Auth/user data is never cached by the SW. First match wins, so this
      // shadows defaultCache's NetworkFirst "/api/" entry.
      matcher: ({ sameOrigin, url: { pathname } }) =>
        sameOrigin &&
        (pathname.startsWith("/api/") || pathname.startsWith("/.well-known/")),
      handler: new NetworkOnly(),
    },
    ...defaultCache,
  ],
  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

serwist.addEventListeners();

/* Background Sync is a Chromium-only ENHANCEMENT (TECHSTACK §3) — the exam
   outbox's real triggers are app-level. Where the API exists, the page
   registers the "rl-outbox" tag; when it fires (connectivity returned) we
   nudge any open client to drain. No client ⇒ no-op: the SW cannot
   authenticate on its own (access tokens live in page memory only). */
(
  self as unknown as {
    addEventListener(
      type: "sync",
      listener: (event: {
        tag: string;
        waitUntil(promise: Promise<unknown>): void;
      }) => void,
    ): void;
  }
).addEventListener("sync", (event) => {
  if (event.tag !== "rl-outbox") return;
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      for (const client of clients) client.postMessage({ type: "RL_OUTBOX_SYNC" });
    }),
  );
});
