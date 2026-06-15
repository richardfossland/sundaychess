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

## Batch 2 — finish the route-resilience sweep (P2/P3, headless)
- [ ] Wrap remaining routes in try/catch → structured 503 (not platform 500/1102 HTML):
  `game/resign`, `game/draw`, `game/claim`, `game/override`, `game/absent`,
  GET `game/[id]` + `tournament/[id]`, `round/*` (move authHost/list inside try),
  `casual/join`, `tournament/open`. (move + resume already done.)
- [ ] `LiveGamesView` spectate channel: add `onStatus` refetch (parity with GameView).
- [ ] `CodesModal`: retry on fetch failure.

## Batch 3 — engine correctness (P2/P3, headless)
- [ ] League standings/podium/team scores filter to **league-phase** games (playoff games
  currently pollute the league table/podium). `score.ts` + board/podium consumers.
- [ ] Win-on-time → **draw** when the winner has insufficient mating material (FIDE 6.9).
  `move` + `claim` routes; use chess.js `isInsufficientMaterial`.
- [ ] Idempotent tiebreak/casual creation: skip if slot already has a 2nd game / guard the
  casual 2-player gate (double-click + two-tab / two-joiner races). `playoff.ts`, `casual.ts`.
- [ ] Cup mode > 32 players: raise/remove the 32 cap or block-and-warn (extras stuck in
  waiting room). `bracket.ts`/`playoff.ts` + waiting-room state.
- [ ] Edge cases: repeat-bye double point (`pair.ts`), zero-active-players round stall +
  `currentRoundResolved` vacuous-true (`league.ts`), override-of-bye mis-score.

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
