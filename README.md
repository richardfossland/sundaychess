# SundaySjakk

A Kahoot-style classroom chess tournament for ungdomsskole. A live Swiss league
(3–7 rounds) with an optional knockout playoff. Students join with a PIN; the
teacher runs a projector "board". Part of the **Sunday Suite**, deployed at
**`sjakk.sundaysuite.app`**.

The chess rules are **server-authoritative**: the client only sends a move
*intent*; the server replays it with `chess.js` against the stored FEN, commits
atomically, and broadcasts the new position. Whose turn it is is server state,
never negotiated between clients.

## Stack

- **Next.js 16** (App Router, TypeScript) — UI + Route Handlers (`/api/*`)
- **Supabase** — Postgres (authoritative store) + Realtime Broadcast (position
  nudges / lobby) + Auth (optional teacher accounts)
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
npm run test       # Vitest — pure logic + route integration (53 tests)
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run build      # next build
```

## Layout

- `lib/chess/` — `validateMove` (apply/legality), `lastMove`
- `lib/tournament/` — `pair` (Swiss), `score` (Buchholz/standings), `bracket`
- `lib/server/` — `store` (DB), `league` / `playoff` (engines), `auth`,
  `broadcast`, `gameEvents`, `http`
- `app/host/` — teacher: wizard, lobby, league board, bracket, podium
- `app/play/` — student: join/resume, waiting room, playable board
- `supabase/migrations/` — `0001_schema` (tables + RLS), `0002_move_apply`
  (atomic `apply_move` / `resolve_game` RPCs)

## Status

Phases 0–7 are **code-complete with unit + route tests green and the app
building**. Live verification (realtime against a real Supabase project, a full
two-browser game, the Cloudflare deploy) is the **rig-test** — see
[docs/RIG-TEST.md](docs/RIG-TEST.md). Deploy steps in
[docs/DEPLOY.md](docs/DEPLOY.md); scope/decisions in
[docs/COMPLETION.md](docs/COMPLETION.md).
