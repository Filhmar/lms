import type { NextConfig } from "next";

/**
 * BACKEND_INTERNAL_URL (server-side only, e.g. http://backend:3200 on the
 * compose network) turns the Next server into the reverse proxy for the API:
 * the browser talks to ONE origin and /api/v1/* + the JWKS well-known path
 * are proxied internally to the backend service. Unset (host dev), the app
 * behaves exactly as before.
 */
const backendInternalUrl = process.env.BACKEND_INTERNAL_URL;

const nextConfig: NextConfig = {
  // Containerized deploys (Azure Container Apps / any OCI runtime) per docs/TECHSTACK.md
  output: "standalone",
  transpilePackages: ["@rl/ui", "@rl/schemas"],
  ...(backendInternalUrl
    ? {
        async rewrites() {
          return [
            {
              source: "/api/v1/:path*",
              destination: `${backendInternalUrl}/api/v1/:path*`,
            },
            {
              source: "/.well-known/jwks.json",
              destination: `${backendInternalUrl}/.well-known/jwks.json`,
            },
          ];
        },
      }
    : {}),
};

export default nextConfig;
