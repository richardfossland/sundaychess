#!/usr/bin/env node
// Feiloversikt for eier. Leser client_events (service-rolle, kun lesing) og
// skriver en oppsummering til terminalen. Se docs/TELEMETRY.md.
//
//   node scripts/errors-report.mjs [--days 14] [--env ../sundaychess/.env.local]
//
// Trenger NEXT_PUBLIC_SUPABASE_URL og SUPABASE_SERVICE_ROLE_KEY (fra .env.local
// eller miljøet). Nøkkelen skrives aldri ut.
import { readFileSync, existsSync } from "node:fs";

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const days = Math.max(1, Math.min(14, Number.parseInt(flag("days", "14"), 10) || 14));
const envPath = flag("env", ".env.local");

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    out[m[1]] = v;
  }
  return out;
}
const fileEnv = existsSync(envPath) ? parseEnv(readFileSync(envPath, "utf8")) : {};
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(`Mangler NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (leste ${envPath}).`);
  process.exit(1);
}

const since = new Date(Date.now() - days * 86_400_000).toISOString();
const PAGE = 1000;
const rows = [];
for (let from = 0; ; from += PAGE) {
  const q = `${url.replace(/\/$/, "")}/rest/v1/client_events?select=at,kind,detail&at=gte.${encodeURIComponent(since)}&order=at.asc`;
  const res = await fetch(q, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + PAGE - 1}`, "Range-Unit": "items" },
  });
  if (!res.ok) {
    // Aldri skriv ut headere/nøkkel; bare status.
    console.error(`Henting feilet: HTTP ${res.status}${res.status === 404 ? " (finnes client_events? kjør migrasjon 0012)" : ""}`);
    process.exit(1);
  }
  const page = await res.json();
  rows.push(...page);
  if (page.length < PAGE) break;
}

// Kontrolltegn (ESC o.l.) fra lagrede rader skal aldri nå terminalen, selv om
// serveren allerede fjerner dem: eldre rader eller en direkte DB-skriving kan ha dem.
const clean = (v) => String(v).replace(/[\x00-\x1f\x7f-\x9f]/g, "");
const day = (iso) => iso.slice(0, 10);
const buildOf = (r) => (r.detail && typeof r.detail.build === "string" && clean(r.detail.build)) || "(ukjent)";

console.log(`Feiloversikt, siste ${days} dager (${rows.length} hendelser)\n`);
if (!rows.length) process.exit(0);

// (a) antall per kind per dag
console.log("== Antall per type per dag ==");
const perDay = new Map();
for (const r of rows) {
  const d = clean(day(r.at));
  if (!perDay.has(d)) perDay.set(d, new Map());
  const m = perDay.get(d);
  m.set(r.kind, (m.get(r.kind) ?? 0) + 1);
}
for (const d of [...perDay.keys()].sort()) {
  const parts = [...perDay.get(d)].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${clean(k)}=${n}`);
  console.log(`${d}  ${parts.join("  ")}`);
}

// (b) js_error gruppert på melding + øverste stack-ramme
console.log("\n== js_error (gruppert) ==");
const groups = new Map();
for (const r of rows) {
  if (r.kind !== "js_error") continue;
  const d = r.detail ?? {};
  const msg = clean(d.message ?? "(uten melding)");
  const frame = clean(d.at ?? d.boundary ?? "(uten ramme)");
  const k = `${msg}\u0000${frame}`;
  let g = groups.get(k);
  if (!g) groups.set(k, (g = { msg, frame, n: 0, first: r.at, last: r.at, builds: new Set() }));
  g.n++;
  if (r.at < g.first) g.first = r.at;
  if (r.at > g.last) g.last = r.at;
  g.builds.add(buildOf(r));
}
if (!groups.size) console.log("Ingen.");
for (const g of [...groups.values()].sort((a, b) => b.n - a.n)) {
  console.log(`${String(g.n).padStart(4)}x  ${g.msg}`);
  console.log(`       ramme: ${g.frame}`);
  console.log(`       første ${g.first}  siste ${g.last}  build: ${[...g.builds].sort().join(", ")}`);
}

// (c) per build
console.log("\n== Antall per build ==");
const perBuild = new Map();
for (const r of rows) perBuild.set(buildOf(r), (perBuild.get(buildOf(r)) ?? 0) + 1);
for (const [b, n] of [...perBuild].sort((a, b) => b[1] - a[1])) console.log(`${b.padEnd(12)} ${n}`);
