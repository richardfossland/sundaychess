# Deploy — chess.sundaysuite.app

**Decision (see the plan):** SundayChess is its **own** deployment on the
subdomain `chess.sundaysuite.app` (the `sundaysuite.app` zone is already on
Cloudflare). The main SundaySuite site is static HTML and cannot host a Next.js
route segment, so there is no `/sjakk` subpath proxy — `basePath` stays root.

## Cloudflare Workers via OpenNext (verified pipeline)

Next 16 SSR is deployed to a **Cloudflare Worker** using `@opennextjs/cloudflare`
(supports `next >=16.2.6`). Config lives in `open-next.config.ts` +
`wrangler.jsonc`. The build pipeline is verified to bundle this app.

```bash
# deps (already in package.json): @opennextjs/cloudflare, esbuild, wrangler

# 1. Build the worker (.open-next/worker.js).
#    NEXT_PUBLIC_* are inlined at build time → real Supabase URL/anon key must
#    be in .env.local (or the shell) BEFORE building.
npx opennextjs-cloudflare build

# 2. Deploy the worker.
#    ⚠️ MUST be `opennextjs-cloudflare deploy`, NOT a bare `wrangler deploy`:
#    the prerendered-page cache lives in `.open-next/cache/` after `build` and is
#    only copied into `.open-next/assets/cdn-cgi/_next_cache/` by the adapter's
#    populateCache step, which `deploy` (and `upload`/`preview`) runs and
#    `wrangler deploy` does not. Deploy without it and the static-assets
#    incremental cache is empty → every prerendered page silently falls back to a
#    full SSR render on every request (the exact cost this config removes).
npx opennextjs-cloudflare deploy        # = wrangler deploy + populateCache

# 3. Server-only runtime secret (NOT inlined):
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY

# 4. Attach the custom domain (sundaysuite.app zone is on this account):
#    wrangler.jsonc `routes`, or Dashboard → Workers → sundaysjakk → Domains →
#    add chess.sundaysuite.app
```

Env summary:
- **Build-time (inlined):** `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_BASE_URL=https://chess.sundaysuite.app`
- **Runtime secret:** `SUPABASE_SERVICE_ROLE_KEY` (`wrangler secret put`)

> Note: the in-memory rate-limiter and draw-offer store assume a single
> instance. Cloudflare may run multiple isolates — see the hardening backlog in
> RIG-TEST.md before relying on them at scale.

## Fallback — Vercel

`vercel` (or connect the repo), set the same env vars, then CNAME
`chess.sundaysuite.app` at Vercel. The app is platform-agnostic; use this if the
Worker runtime surfaces an incompatibility.

## Uptime monitor

A GitHub Actions cron (`.github/workflows/uptime.yml`, every 10 min) probes
`chess.sundaysuite.app` from an external vantage point — catching edge-level
drops a Worker cron can't see itself failing. Targets/budgets live in
`.github/uptime-targets.json`; run it locally with `npm run probe`. A breach
files/updates a GitHub issue labelled `uptime`; recovery closes it.

## Optional: teacher accounts via suite auth

`tournaments.host_user_id` is a ready seam for a real Supabase-Auth teacher
account (so a teacher can reopen a tournament later without the host code). It
is intentionally **not** wired to the church-based suite SSO — schoolteachers
are not church members. Wire it to this project's own Supabase Auth if desired.
