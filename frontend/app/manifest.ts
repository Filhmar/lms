import type { MetadataRoute } from "next";

/**
 * PWA manifest (served at /manifest.webmanifest; Next injects the
 * <link rel="manifest"> automatically). Colors are the Calm Shelter light
 * canvas + primary from packages/ui/src/styles.css.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Resilient-Learn",
    short_name: "ResilientLearn",
    description:
      "Offline-first learning that never stops. Your work is always safe on this device.",
    id: "/",
    start_url: "/",
    display: "standalone",
    background_color: "#F1F5FB",
    theme_color: "#1E4AC2",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
