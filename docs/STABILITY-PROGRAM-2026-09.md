# Stability program — 2026-09-03

One page: what was wrong, what shipped, which PR. Full detail lives in the
commit messages (`git log --oneline`) and in the code comments each fix
points back to. This program is layout (`L`), realtime/resilience (`R`), and
tooling/telemetry (`T`) — the letters match the commit-message tags.

| # | Root cause | Fix | PR |
| --- | --- | --- | --- |
| L1 | The move list grew inside the page flow, so a long game scrolled the whole page instead of just the list. | `MoveList` scrolls only itself (`lib/client/MoveList.tsx`); pinned to the latest ply via `useLayoutEffect`. | #63 |
| L2 | Nothing reserved space for the turn banner / toast / notices, so their appearance shifted the board underneath a player's next tap. | Reserved `.turn-slot` / `.notice-slot` around every board. | #72 |
| L3 | Toasts and the draw-offer banner rendered inline, pushing layout on arrival; top alignment wasn't consistent across board screens. | Toast is `position: fixed`; draw offer is a `ConfirmDialog` modal, not an inline banner; every board screen top-aligns. | #78 |
| L4 | react-chessboard v5's defaults (`allowDrawingArrows`, `clearArrowsOn*`) re-render the board's arrow layer on every poll tick even with no arrows; 1px drag threshold made tap-to-move flaky on touch. | Shared `BOARD_BASE_OPTIONS` (`lib/client/boardOptions.ts`): arrows off, `dragActivationDistance: 8`, `touch-action: manipulation`. | #79 |
| L5 | Presence/board/detail objects got fresh identities on every poll, forcing the board to re-render even when nothing it displayed had changed. | Stable identities + a memoized `PlayBoard`; `perf(play)` insulates the board from unrelated re-renders. | #84 |
| L7 / R10 | Coach advice and the eval bar were computed inline, competing with the move path for main-thread time. | Moved into `lib/chess/engine.worker.ts`; never computed on the move path. | #81 |
| L8 | The host's live grid and single-game spectate view each built their own `<Chessboard>` and read `fenMap`/`BOARD_BASE_OPTIONS` directly, duplicating the insulation work from L5 and leaving the move list unmounted between games. | Grid + spectate both render through the same insulated `PlayBoard`; move list always mounted. | #86 |
| R1 / R1b | An unhandled route exception surfaced as the platform's own 500/1102 HTML, and a malformed id (`22P02` from Postgres) came back as a 503 instead of a clean "not found." | Static-assets cache, JSON-only 404 catch-all, `/api/health`; malformed ids answer 404/400. | #67, #75 |
| R2 | A `localStorage` read on a device with storage disabled (private mode, some school MDM profiles) threw and crashed the page. | Every `localStorage` access guarded. | #65 |
| R3 | Any JSON error, or any edge HTML error page, ended the local session — so a transient edge 503 looked identical to "your code is wrong" and logged the student out. | `shouldClearSession` (`lib/client/api.ts`): only our own `invalid_code`/`not_found` JSON ends a session; edge HTML errors keep it and show a retry card. | #66 |
| R4 | The lobby's presence heartbeat ran on the main thread (throttled or suspended by a locked/backgrounded tab) and the host's ghost-sweep could mass-stamp everyone as "seen" on its own resubscribe, sweeping the room a moment later. Being kicked from the lobby had no way back in. | Heartbeat moved to a Web Worker; sweep gated on host `SUBSCRIBED` + visible; no mass-stamp on resubscribe; `POST /api/lobby/rejoin` + auto-readmit on resume; "Du ble fjernet" screen once pairings exist. | #73 |
| R5 | Two tabs sharing one player identity both tried to be the live board; the loser's moves were rejected as "not your turn," which read to the student as a broken board. A crashed/discarded tab left the survivor waiting forever for a `release` that never came. | Active-tab protocol (`lib/client/activeTab.ts`): claim/heartbeat/release over `BroadcastChannel`, with a TTL-based re-election so a passive tab can never be stranded longer than TTL + tick. | #77 |
| R7 | A stalled realtime channel or a run of failed background syncs looked identical to a frozen board — no feedback, no way to recover short of a manual reload. | "Kobler til igjen …" badge; "Oppdater" button after 3 consecutive failures. | #70 |
| R8 | The move route awaited broadcasts + score recomputation before responding. Under load, the game-ending move (the most memorable one) could outlast the client's 8 s fetch timeout, rolling the board back to `confirmedFen` client-side even though the server had already committed it — the leading suspected cause of the residual Cloudflare "Error 1102" reports. | `defer()` (`lib/server/defer.ts`): the route responds first; broadcasts and score recomputation run in `after()`, backed by `ctx.waitUntil` on the Worker. | #69 |
| R9 | The 5 s board poll fetched the full PGN move-by-move history on every tick, even though only the finished-tournament recap needs it. | PGN is returned only on `?full=1` (`app/api/tournament/[id]/route.ts`), fetched once by the recap view. | #76 |
| R11 | A `CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED` realtime channel was never recreated — the client silently stopped receiving updates until a manual reload. Background tabs polled at the same rate as foreground ones. | Channel recreated with backoff on `CLOSED`; poll interval widens to 20 s/30 s while hidden. | #80 |
| T0 / T1 | CI had no single gate, and outages that only an external vantage point can see (edge-level drops, DNS) had no detector. | `npm run check` consolidates lint + typecheck + test; synthetic uptime probe (`scripts/probe.mjs`, `.github/workflows/uptime.yml`) files a GitHub issue on breach. | #64 |
| T3 | The scenarios above had no automated coverage — every regression could only be caught by a human running the rig. | Playwright specs: `layout-stability`, `reconnect`, `server-errors`, `two-tabs`, `game-end`, `public-flow`, `lobby-rejoin` (see `docs/E2E.md`). | #83 |
| T4 | The e2e suite had no CI lane. | Runs against a real local Supabase on every PR + nightly. | #74 |
| T5 | When something went wrong on a student's device, the teacher had no way to know what — telemetry has never existed in this app. | `POST /api/telemetry` beacon + host "🩺 Diagnostikk" modal, gated on migration 0012 (`supabase/migrations/0012_client_events.sql`). | #87 |
| T7 | SundayTicTacToe would otherwise reinvent every one of the above from scratch. | Porting convention doc, chess → TTT. | #82 |

## What this program did not touch

Three items from `docs/ROBUSTNESS-BACKLOG.md`'s "Deferred — decisions / rig"
list remain genuinely open and are unaffected by the above: the in-memory
rate limiter (needs an edge KV/DO store for multi-isolate accuracy), realtime
channel authorization (cross-class eavesdropping — a product decision, low
risk for a single origin), and overriding an already-finished game (a
product decision, not a bug). See that file for the one item this program
*did* close — the residual Cloudflare "Error 1102" suspicion (R8) — and the
one it closed indirectly (iOS Safari realtime re-subscribe, R11 + R5).
