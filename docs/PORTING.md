# Porting to SundayTicTacToe

[SundayTicTacToe](https://github.com/richardfossland/sundaytictactoe) is a
downstream clone of this repo (cloned without shared git history — its root
commit is `chore: initialize git repository`). Only the rules layer differs
(this repo's `lib/chess/**` vs. its `lib/ttt/**`) plus a handful of
app-specific files — branding, `middleware.ts`, `wrangler.jsonc`,
`README.md`, `LICENSE`/`CONTRIBUTING.md`, Supabase migrations, uptime
targets, the e2e suite. Everything else — Supabase auth/realtime plumbing,
the tournament/host/arranger flow, API error handling, CI, the client
polling/reconnect machinery — is infra both apps share.

## How a port happens

TTT does the actual porting, from its side, with
[`scripts/port-from-chess.sh`](https://github.com/richardfossland/sundaytictactoe/blob/main/scripts/port-from-chess.sh):
it cherry-picks a commit from this repo, strips out everything listed in
[`scripts/port-exclude.txt`](https://github.com/richardfossland/sundaytictactoe/blob/main/scripts/port-exclude.txt)
(chess-only rules/coach/puzzles code, chess-only client components, app
identity/deploy config, migrations, the e2e suite), and runs its own gate.
`scripts/port-status.sh` over there (`npm run port:status`) lists every
commit here that touches a non-excluded path and hasn't been ported yet —
that's the live backlog. See TTT's `docs/PORTING.md` for the full mechanics.

There is nothing to run from this side. What matters here:

- **Keep app-specific code inside the excluded paths.** If a change belongs
  to the chess rules engine, the coach, puzzles, or a chess-only UI piece
  (clock, captured pieces, eval bar, promotion, replay, puzzle card, review),
  keep it under the paths TTT already excludes (`lib/chess/**`,
  `lib/coach/**`, `lib/puzzles.ts`, `lib/server/clock.ts`, `lib/server/llm.ts`,
  the matching `lib/client/*` components, `app/api/coach/**`,
  `app/api/review/**`, `app/play/ReviewView.tsx`). A shared/infra file that
  mentions chess by name inline (a comment, a log message, a route guard)
  won't get caught by path exclusion — `port-from-chess.sh` greps for
  obvious leakage (`sjakk:`, `sundaychess`, `chess.sundaysuite`,
  `CHESS_ADMIN`, `lib/chess`, `app/host/[`) and warns, but keeping the
  actual logic path-isolated is what makes a clean port possible at all.
- **Once a chess PR has been ported, say so here.** Add a line to the PR
  body (or a follow-up comment) on the *chess* side:

  ```
  Port: TTT #<NN>
  ```

  where `<NN>` is the TTT PR number that ported it. This is the mirror of
  TTT's own convention — every port PR over there carries `Port of
  sundaychess#<NN> (<sha>)` in its body.
