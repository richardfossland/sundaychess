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

// Supabase (Realtime-websocket + REST/auth) fra byggets egen URL; faller tilbake
// til hele supabase.co hvis variabelen ikke finnes ved bygging.
function supabaseOrigins(): string {
  try {
    const u = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    return `https://${u.host} wss://${u.host}`;
  } catch {
    return "https://*.supabase.co wss://*.supabase.co";
  }
}

// M10: CSP i Report-Only, IKKE håndhevet. Layouten bruker inline-skript fra Next
// (ingen nonces ennå), så 'unsafe-inline' er med, og vi vil se brudd i konsollen
// før noe håndheves. Egne fonter (lokale), QR som data:-URL, sjakkmotor i en
// Web Worker (worker-src blob:), WASM-fallback. frame-ancestors står i den
// HÅNDHEVEDE headeren under, ikke her (Report-Only ignorerer det direktivet).
const cspReportOnly = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseOrigins()}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

// Hardening for every route (same set as SundayTurnering). The ENFORCED CSP is
// still only frame-ancestors (clickjacking); the full policy runs Report-Only.
const securityHeaders = [
  // Join PINs / codes can travel in URLs — never leak them via Referer.
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
  // M10: HSTS ett år. BEVISST uten includeSubDomains: andre *.sundaysuite.app
  // -apper deler domenet og skal ikke tvinges av denne appen.
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
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
  // Load-bearing, see docs/DECISIONS.md ADR-001: `typescript` is the TS 6 compat
  // package (no `bin.tsc`), so Next must type-check via the in-process API.
  experimental: {
    useTypeScriptCli: false,
  },
};

export default nextConfig;
