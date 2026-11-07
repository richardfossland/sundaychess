# SundayChess

A big-screen classroom chess tournament for ungdomsskole. A live Swiss league
(3–7 rounds) with an optional knockout playoff, plus a knockout-only "cup"
format. Students join with a PIN; the organiser runs a projector "storskjerm" (big screen) —
lobby, live standings, bracket, podium, full results with print/PDF export,
and a private note-to-self. Outside a tournament, `/solo` has an 18-lesson
"Lær sjakk" coach curriculum plus a bot to practice against, and `/versus` is
a same-device two-player board with no tournament at all. Part of the
**SundaySuite**, deployed at **`chess.sundaysuite.app`**.

The chess rules are **server-authoritative**: the client only sends a move
*intent*; the server replays it with `chess.js` against the stored FEN, commits
atomically, and broadcasts the new position. Whose turn it is is server state,
never negotiated between clients.

## Stack

- **Next.js 16** (App Router, TypeScript) — UI + Route Handlers (`/api/*`)
- **Supabase** — Postgres (authoritative store) + Realtime Broadcast (private
  channels: position nudges / lobby) + Auth (optional organiser accounts)
- **Cloudflare Workers** via OpenNext (`npm run cf:build`) — see docs/DEPLOY.md.
  The Worker is still named `sundaysjakk` in `wrangler.jsonc` on purpose (legacy
  deploy target; renaming would create a new Worker without secrets)
- **chess.js** — rules authority (server) + optimistic hints (client)
- **react-chessboard v5** — the board UI

## Develop

```bash
npm install
cp .env.example .env.local   # fill in Supabase keys (see docs/RIG-TEST.md)
npm run dev                  # http://localhost:3000
```

Quality gate (run before committing):

```bash
npm run test       # Vitest — pure logic + route integration
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run build      # next build
```

## Layout

- `lib/chess/` — `validateMove` (apply/legality), `lastMove`
- `lib/tournament/` — `pair` (Swiss), `score` (Buchholz/standings), `bracket`
- `lib/server/` — `store` (DB), `league` / `playoff` (engines), `auth`,
  `broadcast`, `gameEvents`, `http`, `pair` (HMAC pairing tokens)
- `lib/physical/` — physical (over-the-board) tournament mode: event-sourced
  `reducer`, offline storage, cloud sync, print, TRF16/CSV export inputs
- `lib/client/`, `lib/sw/` — shared UI/hooks; service worker source (stamped with
  the build id and served from `app/sw.js/route.ts`)
- `app/arranger/` — organiser entry (`/arranger`: wizard) and `fysisk/`, the
  physical tournament mode that works offline (PWA)
- `app/host/` — organiser: lobby, league board, bracket, podium, dashboard
- `app/play/` — student: join/resume, waiting room, playable board
- `app/solo/` — «Lær sjakk» lessons, puzzles and bot practice
- `app/versus/` — same-device two-player board
- `app/f/` — public read-only view of a published physical tournament
- `supabase/migrations/` — `0001`–`0019`, run by hand in the SQL editor. Runbooks
  for `0014` onward are `docs/MIGRATIONS-*.md`; **`0018` must run before deploy**.
  See docs/DEPLOY.md for the order

## Status

**Live** at chess.sundaysuite.app (Cloudflare Worker). Digital tournaments,
solo/versus play and the offline physical tournament mode (with optional cloud
publishing and «fortsett digitalt») are shipped; remaining verification is the
physical **rig-test** on real devices — see [docs/RIG-TEST.md](docs/RIG-TEST.md).
Deploy steps and migration order (build from a clean worktree, never with a
local `.env.local`) in [docs/DEPLOY.md](docs/DEPLOY.md); scope/decisions in
[docs/COMPLETION.md](docs/COMPLETION.md); physical mode in
[docs/FYSISK-MODUS.md](docs/FYSISK-MODUS.md).
