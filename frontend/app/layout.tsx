import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import { SerwistProvider } from "@serwist/turbopack/react";
import "@rl/ui/styles.css";
import "./globals.css";
import { SessionProvider } from "@/lib/session";
import { SwUpdate } from "@/components/sw-update";
import { GlobalHotkeys } from "@/lib/hotkeys";

const archivo = Archivo({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-archivo",
});

export const metadata: Metadata = {
  title: "Resilient-Learn",
  description:
    "Offline-first learning that never stops. Your work is always safe on this device.",
  applicationName: "Resilient-Learn",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F1F5FB" },
    { media: "(prefers-color-scheme: dark)", color: "#0C1322" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={archivo.variable} suppressHydrationWarning>
      <body>
        {/* SW registration (scope "/" via Service-Worker-Allowed from the
            /serwist route). Disabled in dev so `pnpm dev` stays fast;
            reloadOnOnline stays off — never auto-reload a learner's page. */}
        <SerwistProvider
          swUrl="/serwist/sw.js"
          disable={process.env.NODE_ENV === "development"}
          reloadOnOnline={false}
        >
          <SessionProvider>
            {children}
            <GlobalHotkeys />
          </SessionProvider>
          <SwUpdate />
        </SerwistProvider>
      </body>
    </html>
  );
}
