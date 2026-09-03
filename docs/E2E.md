# End-to-end tests (Playwright)

The browser tier. `npm run check` (lint + typecheck + vitest) stays node-only
and fast; this is where the rendered app, two real devices and the network in
between get their coverage.

## What runs

`playwright.config.ts` drives the **production build** through `next start` —
not `next dev`, and not wrangler. Two projects run by default:

| project            | engine   | viewport | why                                  |
| ------------------ | -------- | -------- | ------------------------------------ |
| `desktop-chromium` | Chromium | 1440×900 | the teacher's laptop                 |
| `mobile-chromium`  | Chromium | 390×844  | the borrowed phone (touch, iPhone 13)|
| `mobile-webkit`    | WebKit   | 390×844  | opt-in: `E2E_WEBKIT=1`               |

Specs never shorten the app's timings. The shipped constants are an 8 s fetch
timeout (`lib/client/api.ts`), an 11 s pending watchdog and a 3 s game poll
(`app/play/GameView.tsx`) and a 5 s board poll (`lib/client/useBoardState.ts`);
assertions use `expect.poll` with budgets chosen against those numbers.

## The `E2E_SEAM` variable — read this before deploying anything

`POST /api/dev/quickmatch` mints a tournament, two players and a live game in
one unauthenticated call. It is 404 in a production build **unless**
`E2E_SEAM=1` is in the server process's environment.

Why a second variable at all: `process.env.NODE_ENV` is inlined by the compiler,
so a production bundle carries the literal and nothing at runtime can reopen the
seam. `E2E_SEAM` is an ordinary server env var — Next only inlines `NEXT_PUBLIC_*`
— so it is read per request. That is what lets the suite test the exact bundle we
ship instead of a special test build.

> ⚠️ **`E2E_SEAM` must never be set on the Worker.** Not in `wrangler.jsonc`
> `vars`, not via `wrangler secret put`, not in the Cloudflare dashboard. With
> the seam open, anyone can create unlimited tournaments, players and games.
> It belongs only to `npm run e2e:server`, which is local and CI.

The gate is `!== "1"`, so a half-set variable (`""`, `"0"`, `"true"`) fails
**closed**. `test/quickmatchGate.test.ts` pins that, and runs in `npm run check`.

## Local recipe

Needs Docker (for local Supabase) and the Playwright browsers.

```bash
# 0. one-off
npm ci
npm run e2e:install                       # chromium + its OS deps

# 1. local database — NEVER production credentials
supabase start -x studio,inbucket,imgproxy,edge-runtime,vector,analytics,storage,functions
supabase db reset                         # applies supabase/migrations/*

# 2. point the app at it (values are local-only, printed by the CLI)
eval "$(supabase status -o env |
  sed -e 's/^API_URL=/NEXT_PUBLIC_SUPABASE_URL=/' \
      -e 's/^ANON_KEY=/NEXT_PUBLIC_SUPABASE_ANON_KEY=/' \
      -e 's/^SERVICE_ROLE_KEY=/SUPABASE_SERVICE_ROLE_KEY=/' |
  sed 's/^/export /')"

# 3. build once, then run the suite (Playwright starts `next start` itself)
npm run e2e:build
npm run e2e
```

`supabase start`'s `-x` names come from `supabase start --help`; the full set is
`analytics, db, edge-runtime, functions, imgproxy, inbucket, kong, meta,
realtime, rest, storage, studio, vector`. The app needs `db`, `kong`, `rest` and
`realtime` — everything else above is excluded only to start faster. Plain
`supabase start` works too.

`NEXT_PUBLIC_*` values are **inlined at build time**, so step 2 must come before
step 3. Rebuild after repointing at a different database.

Useful variations:

```bash
npm run e2e -- --project=desktop-chromium     # one project
npm run e2e -- --repeat-each=3                # flake hunt
npm run e2e -- --headed --debug               # watch it
E2E_WEBKIT=1 npm run e2e                      # add iPhone Safari's engine
npx playwright test --list                    # config sanity, no browser needed
npx playwright show-report                    # after a failure
```

`reuseExistingServer` is on locally: a `next start` already listening on :3000 is
adopted. If you changed app code, rerun `npm run e2e:build` — otherwise the suite
happily tests the previous build.

## Layout

```
e2e/
  smoke.spec.ts        two students, two contexts, e4/e5 seen on both boards
  fixtures/match.ts    createMatch (seam) · publicFlowMatch (public routes only)
                       · openAs (seed localStorage → /play → real resume path)
  pages/board.ts       BoardPage — clickMove/dragMove/pieceAt/turnBanner/boardBox
  helpers/cls.ts       layout-shift accumulator (installCls before goto)
```

`openAs` fakes no screens: it writes `sjakk:player` via `addInitScript` and lets
`/play` walk its real path — `attemptResume` → `WaitingRoom` latches the live
game → `GameView` mounts — then waits for `board-shell`.

`publicFlowMatch` exists so at least one spec reaches a live board **without**
the seam, mirroring `scripts/smoke-features.mjs`. Without it the suite would only
ever prove that the shortcut works.

`dragMove` uses `page.mouse` with intermediate steps rather than `dragTo()`:
react-chessboard v5 drives dnd-kit, whose pointer sensor ignores a single jump
from origin to destination.

## Test ids

Stable hooks, kebab-case, added only where a spec needs one. The same names are
intended for SundayTicTacToe, so keep them generic:

`board-shell` · `turn-banner` · `toast` · `result-card` · `passive-tab` ·
`load-error` · `join-screen` · `resume-retry` · `waiting-room` · `movelist`

Prefer these over class names and copy: a restyle or a wording pass must not
break the suite.
