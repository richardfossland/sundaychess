# Deploy — sjakk.sundaysuite.app

**Decision (see the plan):** SundaySjakk is its **own** deployment on the
subdomain `sjakk.sundaysuite.app`. The main SundaySuite site is static HTML on
Cloudflare Pages and cannot host a Next.js route segment, so there is no
`/sjakk` subpath proxy — `basePath` stays root.

## Option A — Cloudflare Pages (matches the suite)

The app uses SSR Route Handlers, so it needs the Cloudflare adapter rather than
a static export.

1. Add the adapter:
   ```bash
   npm i -D @cloudflare/next-on-pages
   ```
2. Build for Pages:
   ```bash
   npx @cloudflare/next-on-pages
   ```
3. Create the Pages project and deploy:
   ```bash
   npx wrangler pages deploy .vercel/output/static \
     --project-name sundaysjakk --compatibility-flags nodejs_compat
   ```
4. **Custom domain:** add `sjakk.sundaysuite.app` to the `sundaysjakk` Pages
   project (Cloudflare → Pages → Custom domains). DNS is already on Cloudflare
   for `sundaysuite.app`.
5. **Environment variables** (Pages → Settings → Variables, Production):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (encrypt)
   - `NEXT_PUBLIC_BASE_URL=https://sjakk.sundaysuite.app`
   Set `nodejs_compat` in compatibility flags.

> Note: the in-memory rate-limiter and draw-offer store assume a single
> instance. Cloudflare may run multiple isolates — see the hardening backlog in
> RIG-TEST.md before relying on them at scale.

## Option B — Vercel (simplest for Next SSR)

`vercel` (or connect the repo). Set the same four env vars. Then point
`sjakk.sundaysuite.app` (CNAME) at Vercel. Use this if the Cloudflare adapter
proves fiddly; the app is otherwise platform-agnostic.

## Optional: teacher accounts via suite auth

`tournaments.host_user_id` is a ready seam for a real Supabase-Auth teacher
account (so a teacher can reopen a tournament later without the host code). It
is intentionally **not** wired to the church-based suite SSO — schoolteachers
are not church members. Wire it to this project's own Supabase Auth if desired.
