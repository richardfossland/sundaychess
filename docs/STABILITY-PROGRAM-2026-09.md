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

## Runde 2 (05.–06.09)

A second pass, three adversarial audits against `main` (UX/tilgjengelighet,
kodehelse/sikkerhet, produkt) run back-to-back with the fixes — 20 PRs, #90
through #110 (#109 not merged). Same format: one line per PR, grouped by
what the audit was hunting for. Root-cause detail lives in each PR's own
body (`gh pr view <n> --repo richardfossland/sundaychess`); the letter codes
below (H\*/M\*) are the ones the kodehelse/sikkerhet audit actually used —
not every finding got one, and this program doesn't invent codes for the
ones that didn't.

### Sikkerhet

| PR | Finding | Fix |
| --- | --- | --- |
| #101 | Realtime is reached with the public anon key and every topic id is derivable from an unauthenticated GET; a forged broadcast could end or freeze anyone's game. | Broadcasts are treated as untrusted hints only: `status` is never applied from a payload, a `position` is provisional until the next authoritative fetch wins the ply guard (`lib/realtimeTrust.ts`, `resolveAuthoritative`); topics gain a `chess:` prefix so chess and TTT can no longer collide on the shared Supabase project; a late presence subscriber (M5, `lib/supabase/channelRegistry.ts`) now actually tracks. |
| #91 | Migration-file audit: `cleanup_old_tournaments()`/`cleanup_client_events()` are `security definer` functions in `public` with `EXECUTE` still granted to `PUBLIC` — a bare anon key could run a definer-rights DELETE/UPDATE via `POST /rest/v1/rpc/...`; separately, a casual (1v1) session could be deleted by the retention cron while its game was still live. | `supabase/migrations/0013_revoke_cleanup_exec_casual_guard.sql` revokes EXECUTE from `public`/`anon`/`authenticated`; casual retention raised 1→7 days and never fires while a live game exists. SQL-only, idempotent — 👤 owner runs it by hand after 0012. |
| #97 | Host/resume codes were shown in the clear on the projector by default — one glance from the back row leaks a takeover code. | Host code hidden behind a "Vis vertskode" tap-to-reveal chip (auto-hides in 20 s); every resume code in `CodesModal` masked (`maskCode`, `lib/codes.ts`) until revealed one row at a time; `window.confirm` replaced with themed `ConfirmDialog` for kick/force-resolve/override. |
| #95 | H1/H2/M3/M6 — a route could throw before its own try/catch and hand the client an HTML 500/1102 page instead of JSON; a malformed (non-UUID) id produced a false `503 outage` instead of a clean 4xx; eight store writes (`setPlayerStatus`, `recomputeScores`, …) swallowed their PostgREST error and reported success for a write that never happened; two dead exports removed. | Five routes wrapped in a thin `POST → handlePost`; the uuid guard moved inside `authPlayer`/`authHost` (11 call sites at once) plus explicit guards on direct callers; all eight silent-`void` writes now `throw error` so their callers' existing try/catch answers a truthful `503`. |
| #102 | H4/H5/M1 — the 5 s board poll (`GET /api/tournament/[id]`, `GET /api/game/[id]`) and the player-action POSTs (`draw`/`resign`/`claim`) had no rate limit at all; `tournament/open` (the host-code brute-force oracle) only checked its own bucket. | `rateLimit("board:"+ip, 600, 60_000)` and `rateLimit("gameact:"+ip, 120, 60_000)` added; `tournament/open` now also checks the shared `hostRateLimit` bucket, behind the #95 shape guard. Remaining side-effects on `game/override`, `game/absent`, `join`, `lobby/kick`, `round/extend` moved off the response path into `defer()` (M1, completing R8's sweep). |
| #105 | Student identity lived in one `localStorage` slot per browser: joining tournament B silently discarded the resume code for tournament A (a shared classroom tablet, or a student scanning a new PIN while the old one was still live), and telemetry attributed every event to whichever tournament happened to be in that slot. | Per-tournament session keys with a "last" pointer + legacy migration (`lib/client/session.ts`); telemetry now only attributes `tournament`/`player`/`game` ids on events that actually come from `/play`. Deliberately **without** an HttpOnly cookie — a tournament is a single school hour, well inside Safari ITP's 7-day window, so a cookie would add server surface with no symptom behind it. |

### Opplevelse

| PR | Finding | Fix |
| --- | --- | --- |
| #93 | A student who backgrounds the tab or locks their phone can miss their turn entirely — nothing signals "it's your move" outside the tab. | While `isMyTurn && live && document.hidden`: title alternates with "▶ Din tur! – SundayChess", a short vibration, and (only if already granted) a `Notification` — opt-in via a new 🔔 `NotifyToggle`, never auto-requested. |
| #98 | The waiting room between rounds gave no sense of progress, and bye/finished copy was generic. | "Runde n av N · X partier igjen" (`lib/tournament/progress.ts`, `waitingProgress`), falling back to "Venter på at arrangøren starter runde n+1"; specific bye/finished copy; the initial-load error card reuses the same "why" copy as elsewhere. |
| #99 | The full wizard was the only way to start a tournament — slow for a teacher who just wants the defaults. | "⚡ Rask start" creates a league (5 rounds, no playoff) immediately, auto-titled "Turnering DD.MM"; single-select wizard steps now auto-advance ~150 ms after a tap. |
| #100 | Solo "Lær sjakk" had 4 tasks and promised "small tasks" it didn't deliver. | 18 verified lessons, piece-moves through mate-in-one, each solution checked by a test instead of by eye. |
| #103 | Only the podium showed on the finished screen — ranks 4+ were invisible on the projector; no way to save/print results; no signal for a walkover/absent/override result in the standings. | Full standings table under the podium; "Skriv ut / lagre som PDF" (`window.print()` + a `@media print` stylesheet); `resultSource` markers (W.O./Fraværende/Overstyrt/Tid ute) with a tiebreak (Buchholz) gloss; a "Slik funker det" strip + discreet `/host` link on the landing page. |
| #108 | Marking a student "borte" had no way back, and a late-joiner was pointed at a PIN screen that always dead-ended. | `POST /api/game/reinstate` (host-auth, rate-limited): a `left` player collapses under "Ute av turneringen (n)" in `LeagueView` with a "Ta inn igjen" button, paired again from the *next* round only; late-join copy now says the truth instead of implying a PIN will work. |
| #110 | No escape hatch to end a league early, nowhere for a teacher's private note, and a waiting/eliminated student's only option was to stare at a board. | "Avslutt etter denne runden" lowers `config.leagueRounds` to the round in progress (never below, never raised); `config.notes` (≤280 chars, `NotesModal`) — stripped from the public board DTO, so students never see it; a solo-practice link surfaced for waiting/eliminated players. |
| #92 | The cup (playoff) bracket had no time-up control at all — only the league view got one; `FullscreenToggle` was missing from most projector screens. | Ported the ⏰ banner + "Avslutt runden" `ConfirmDialog` to `BracketView`; `FullscreenToggle` mounted on lobby/standings/bracket/podium, hiding itself where `requestFullscreen` is unsupported (iPhone Safari). |

### A11y

| PR | Finding | Fix |
| --- | --- | --- |
| #104 | Every dialog (`ConfirmDialog`, promotion picker, draw offer, result overlay) rolled its own focus/Escape handling, a global `keydown` bound Enter to "confirm" everywhere at once, and Escape on the promotion picker silently committed a queen. | Shared `lib/client/Modal.tsx`: `role="dialog"`/`aria-modal`, a pure `nextFocusable` focus trap, focus returned to the opener, Escape/backdrop → `onClose`, body scroll lock, no global Enter binding. Promotion Escape now cancels; the draw-offer dialog's Escape/backdrop dismiss without declining (new "Svar på remistilbudet" ghost button reopens it). |
| #107 | 12-finding accessibility/visual sweep: JS-driven animation (confetti, board piece animation) ignored `prefers-reduced-motion`; toggle groups had no `aria-pressed`; several touch targets were under 44 px; the big `RoundTimer` re-announced every second. | `lib/client/useReducedMotion.ts` (SSR-safe) gates `Confetti` and all six `<Chessboard>` call sites; `aria-pressed` on every toggle group; `.chip-kick` 20→32px, sound/fullscreen/notify toggles 42→44px; `RoundTimer`'s big variant `aria-live="off"` plus a separate visually-hidden assertive announcer. |

### Hygiene

| PR | What |
| --- | --- |
| #90 | `testTimeout: 60_000` — the engine specs (`search`/`bot`/`engineProtocol`) run a real 150k-node budget and were timing out under vitest's 5 s default (7 timeouts observed running the audits). |
| #94 | Error boundaries (`app/error.tsx`/`global-error.tsx`) now report to telemetry (the one client crash path telemetry never saw); LLM narration abort timeout made explicit (6000 ms, under the client's 8000 ms); README/docs hostname + test-count hygiene; missing `.banner-ok`/`.btn-sm` CSS classes; `app/loading.tsx` added. |
| #96 | CI hygiene: `concurrency` group on `ci.yml`; explicit `permissions` + always-on Playwright report upload on `e2e.yml`; `supabase/setup-cli` v1→v3 (drops the deprecated JS-action runtime); wrangler `compatibility_date` bump. |
| #106 | `eslint-config-next`'s `react.version: "detect"` calls a method ESLint 10 removed — fixed by passing the react version explicitly (same recipe as the quiz-app pilot). |

## Kjent rest

- **Presence-nøkler er fortsatt selvhevdet** (#101's "Not addressed here") —
  en forfalsket presence-nøkkel kan få en spøkelse-elev til å se online ut;
  den kan ikke få en ekte elev til å se fraværende ut. Lukkes bare av
  autentisert Realtime (Supabase Realtime Authorization / RLS på
  `realtime.messages`), ikke en klientsjekk.
- **Rate-limiteren er fortsatt per-isolate × per-kilde-IP** (#102's ærlighetsfiks
  i `lib/server/http.ts`) — en reell demper, ikke et hardt tak, før den flyttes
  til en delt butikk (edge KV eller en Durable Object).
- **Migrasjoner 0012 og 0013 må kjøres av eier** i Supabase Dashboard SQL-editor
  (0013 etter 0012) — begge er SQL-only og idempotente, appen tåler at de
  mangler, men ingen av dem kjører seg selv.
- **Uptime-cron:** `.github/workflows/uptime.yml` er satt til 10-minutters
  offset-minutter (`3,13,23,33,43,53 * * * *`) fordi GitHub er kjent for å
  bruke opptil ~2 timer på å registrere en *ny* cron-schedule etter merge —
  se kommentaren i fila. Sjekk Actions-fanen at den faktisk trigger, ikke bare
  at filen er riktig.
- **Cloudflare Workers Free-plan CPU-tak** — den delte kontoen kjører på Free
  i dag; en CPU-tung request (f.eks. et lastet møte-poll under en full
  klasseøkt) kan treffe taket før noen kode-fiks hjelper. Oppgradering til
  Workers Paid er en eierbeslutning, ikke noe denne runden løste.
