import path from "node:path";
import type { NextConfig } from "next";

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
