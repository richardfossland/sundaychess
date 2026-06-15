# SundayChess robustness backlog

From a multi-agent adversarial audit of `main` (2026-06-15). 40 findings, **no P0**
(the criticals were already fixed this session). Items are verified; the obvious-but-
wrong theories were dropped. Work top-down; each batch = one PR + deploy.

## ✅ Done earlier this session (deployed)
Freeze/fetch-timeout (PR #11), 1102/illegal-move/kick resilience (PR #12), tournament
robustness (#5), atomic team-join (migr 0008), playoff tiebreak (#6), casual 1v1 (#7),
contrast (#8), back-buttons (#9/#10).

## Batch 1 — client resilience  ✅ (this PR)
- [x] Recovery poll runs on **every** live turn (was disabled on my own turn → a lost
  game-end event froze me). `GameView` poll guard.
- [x] `GameView` adds the `visibilitychange` resync listener (Chromebook tab-switch).
- [x] Claim-win button: in-flight guard + reconcile (via `runMeta`).
- [x] `doResume`: a transient blip no longer shows "invalid code" (dead-end).

## Batch 2 — finish the route-resilience sweep (P2/P3, headless)  ✅
- [x] Wrapped 11 remaining routes (thin POST/GET → handler) → structured 503 (no
  platform 500/1102 HTML): `game/resign`, `game/draw`, `game/claim`, `game/override`,
  `game/absent`, GET `game/[id]` + `tournament/[id]`, `tournament/[id]/codes`,
  `predict`, `casual/join`, `tournament/open`. (move/resume/join/create/round-*/casual
  already had try.)
- [x] `LiveGamesView` spectate channel: `onStatus` → `onStale()` refetch (parity).
- [x] `CodesModal`: retry button on fetch failure.

## Batch 3 — engine correctness (P2/P3, headless)  ✅ (partial; rest → B4/B6)
- [x] Individual standings/podium filter to **league-phase** games (board route): playoff
  games no longer pollute the league table/podium/FinalResults. (Team standings via the SQL
  `recompute_scores` still sum all phases → moved to Batch 4, needs a migration.)
- [x] Win-on-time → **draw** when the winner can't mate (FIDE 6.9): `winnerCanMate`
  (`lib/chess/material.ts`) wired into the `move` flag path + `claim` route.
- [x] Cup mode cap raised 32 → 256 (`bracket.ts`) — no longer silently drops players 33+.
- [x] `currentRoundResolved` no longer vacuously-true on an empty round; `advanceRound`
  finishes instead of pairing an empty, un-advanceable round when <2 active remain (`league.ts`).
- [ ] → B4: idempotent tiebreak/casual creation (needs a DB unique index / advisory lock).
- [ ] → B6 (P3 polish): repeat-bye double point (`pair.ts`), override-of-bye mis-score,
  team-standings phase filter (SQL), cup block-and-warn UI when >256.

## Batch 4 — scale / Worker-pressure (P2/P3, headless; some DB)
- [ ] Board payload: stop shipping decided-game **PGN** on the 5s poll (add a `pgn` flag the
  finished screen requests). `dto.ts` + `tournament/[id]`. (Live games already omit it.)
- [ ] Game-detail: avoid full PGN replay on every 3s poll where possible.
- [ ] Server-side fetch timeout for Supabase reads + `broadcast()` (a hung DB pins a Worker).
- [ ] Explicit `.limit()` on list queries (PostgREST max_rows=1000 truncation safety).
- [ ] `gameClock` does 3 serial DB round-trips/move — collapse.
- [ ] Casual tournaments: tighten retention (they evade the 2-day empty-lobby rule).

## Batch 5 — test coverage (headless)
- [ ] auto-draw classification (only checkmate tested), `forceResolveRound`/
  `currentRoundResolved`, `startCup`, round-advance guards/double-fire, `afterGameResolved`
  side-effects asserted, an e2e league sim through `pairLeagueRound`.

## Deferred — decisions / rig
- Teacher **override on an already-finished game**: NOT auto-changed — correcting a finished
  result is a legitimate feature; needs a product decision (allow + idempotent vs require-live).
- Rate limiter → shared store (edge KV/DO) for multi-isolate accuracy (bounded already).
- Realtime channel authorization (cross-class eavesdropping; low for single origin).
- The real **multi-device Chromebook stress-test** — only the rig can confirm.
- Confirm residual **Error 1102** cause via Cloudflare Workers observability (already enabled).
