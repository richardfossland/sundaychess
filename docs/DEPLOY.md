# Deploy — chess.sundaysuite.app

**Decision (see the plan):** SundayChess is its **own** deployment on the
subdomain `chess.sundaysuite.app` (the `sundaysuite.app` zone is already on
Cloudflare). The main SundaySuite site is static HTML and cannot host a Next.js
route segment, so there is no `/sjakk` subpath proxy — `basePath` stays root.

## ⚠️ Never build production from a dirty checkout

`NEXT_PUBLIC_*` values are inlined into the bundle at build time and
`.env.local` takes part in `next build` / `opennextjs-cloudflare build`. On
**2026-11-04 a deploy shipped `localhost` as the join address** because a dev
`.env.local` was present during the build. Always:

1. Build from a **clean worktree** of the commit being shipped (`git worktree
   add ../wt-chess-deploy <sha>`), never from the main clone.
2. Make sure that worktree has **no `.env.local`** (or `.env*.local`). Provide the
   production values explicitly: `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_BASE_URL=https://chess.sundaysuite.app`,
   `NEXT_PUBLIC_SUNDAY_AUTH_URL`, `NEXT_PUBLIC_SUNDAY_AUTH_ANON_KEY`,
   `NEXT_PUBLIC_COOKIE_DOMAIN=.sundaysuite.app`.
3. After building, `grep -r localhost .open-next/assets/_next/static | head`
   should find nothing app-specific.

> The Worker is still named **`sundaysjakk`** in `wrangler.jsonc`. That is
> intentionally legacy: the name is the deploy target in Cloudflare (and what
> `wrangler rollback` and secrets are bound to). Renaming it would create a NEW
> Worker with no secrets. Do not "fix" it.

## Cloudflare Workers via OpenNext (verified pipeline)

Next 16 SSR is deployed to a **Cloudflare Worker** using `@opennextjs/cloudflare`
(supports `next >=16.2.6`). Config lives in `open-next.config.ts` +
`wrangler.jsonc`. The build pipeline is verified to bundle this app.

> `wrangler.jsonc`'s `compatibility_date` was bumped **2026-09 → `2026-08-01`**
> (from a stale `2025-05-05`, ~16 months old — `@opennextjs/cloudflare`'s own
> build step warns past 6 months, and its scaffolding falls back to this exact
> date). `npm run cf:build` was reverified against it. **Smoke-test the first
> deploy after this merge** — a compat-date bump changes workerd's runtime
> behavior (e.g. `nodejs_compat` semantics), not just the version string.

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

# 3. Server-only runtime secrets (NOT inlined):
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put PAIR_SECRET        # see docs/MIGRATIONS-0014.md §2

# 4. Attach the custom domain (sundaysuite.app zone is on this account):
#    wrangler.jsonc `routes`, or Dashboard → Workers → sundaysjakk → Domains →
#    add chess.sundaysuite.app
```

Env summary:
- **Build-time (inlined):** `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_BASE_URL=https://chess.sundaysuite.app`
- **Runtime secrets:** `SUPABASE_SERVICE_ROLE_KEY`, `PAIR_SECRET`
  (`wrangler secret put`). Optional: `ANTHROPIC_API_KEY`.
- **Service worker:** `/sw.js` is served by `app/sw.js/route.ts` with the build id
  (git short SHA) stamped into its cache names, so every deploy gets a fresh
  worker and old caches are deleted when the new one activates (after the
  in-app «Ny versjon» prompt, never mid-round). Build from a git checkout, or
  all builds share the fallback id `dev`.

> Note: the in-memory rate-limiter and draw-offer store assume a single
> instance. Cloudflare may run multiple isolates — see the hardening backlog in
> RIG-TEST.md before relying on them at scale.

## Database migrations (manual, shared Supabase project)

The owner runs `supabase/migrations/*.sql` by hand in the Supabase Dashboard SQL
editor (this project shares a Supabase instance with SundayTicTacToe — chess
lives in `public`, TTT in schema `tictactoe` — so there is no automated
`supabase db push` to prod). Each file is written to be idempotent/re-runnable.
Run them in numeric order; `0001`–`0013` are covered by the file headers, and
`0014` onward have a runbook each:

| Migration | Runbook | Order vs. deploy |
|---|---|---|
| `0014_realtime_private` + `0015_code_attempts` | [MIGRATIONS-0014.md](MIGRATIONS-0014.md) (also `PAIR_SECRET`) | **before** code |
| `0016_physical_cloud` | [MIGRATIONS-0016.md](MIGRATIONS-0016.md) | before code (physical cloud sync) |
| `0017_physical_continue` | [MIGRATIONS-0017.md](MIGRATIONS-0017.md) | before code |
| `0018_atomic_rounds_lockdown` | [MIGRATIONS-0018.md](MIGRATIONS-0018.md) | **MUST run before deploy** — without `start_round`, «Start turnering» / «Neste runde» fail with 500 |
| `0019_player_kicked` | [MIGRATIONS-0019.md](MIGRATIONS-0019.md) | before or after; before recommended |

Check each runbook's own order/rollback section; never deploy code ahead of its
migration.

**Rollback across the host-code change:** tournaments created after it have 10-character
host codes. Code from before it (`0a53499` and older) rejects those on reopen with 400
`invalid_code`, though a teacher's already-open tab keeps working. Roll back only if you
accept that, and check for such tournaments first.

👤 **Run `0013_revoke_cleanup_exec_casual_guard.sql` after `0012_client_events.sql`.**
It revokes the anon/authenticated `EXECUTE` grant that Postgres implicitly gave
`public.cleanup_old_tournaments()` / `public.cleanup_client_events()` (both
`security definer`, both callable — before this — via
`POST /rest/v1/rpc/cleanup_old_tournaments` with the public anon key), and
re-defines `cleanup_old_tournaments()` so a casual 1v1 session is never deleted
while one of its games is still `live`, with the casual retention window raised
from 1 day to 7. See the migration file's header comment for the full findings.

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
