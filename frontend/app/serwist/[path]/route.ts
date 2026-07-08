/**
 * Serwist route handler — Next 16 builds with Turbopack, which does not run
 * webpack plugins, so the SW is compiled here (esbuild) and served as a
 * force-static route: /serwist/sw.js (+ sourcemap). The response carries
 * `Service-Worker-Allowed: /`, so registration scope is "/" (see the
 * SerwistProvider in app/layout.tsx).
 */

import { createSerwistRoute } from "@serwist/turbopack";

// The precached /offline document references build-hashed chunks, so its
// precache entry must be revised on every build.
const revision = crypto.randomUUID();

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    swSrc: "app/sw.ts",
    useNativeEsbuild: true,
    additionalPrecacheEntries: [{ url: "/offline", revision }],
  });
