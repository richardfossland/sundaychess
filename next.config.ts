import path from "node:path";
import { execSync } from "node:child_process";
import type { NextConfig } from "next";

// Kort commit-SHA for denne bygga. Legges på hver telemetrihendelse (`build`),
// så eieren ser hvilken versjon en feil kom fra. Faller tilbake til "dev" hvis
// git mangler (f.eks. bygg fra en tarball).
function buildId(): string {
  try {
    const sha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    return /^[0-9a-f]{4,40}$/i.test(sha) ? sha : "dev";
  } catch {
    return "dev";
  }
}

// Hardening for every route (same set as SundayTurnering). Deliberately NOT a
// full CSP: the layout loads next/font and the app opens Supabase Realtime
// websockets, so only frame-ancestors is set (clickjacking) — a stricter policy
// would need nonces and a connect-src allowlist.
const securityHeaders = [
  // Join PINs / codes can travel in URLs — never leak them via Referer.
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: buildId() },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The service worker must never be served from a long-lived cache.
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
          { key: "Content-Type", value: "text/javascript; charset=utf-8" },
        ],
      },
    ];
  },
  // Pin the workspace root: a stray parent lockfile (~/package-lock.json) would
  // otherwise be auto-selected and break output tracing / env resolution.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
