# Rig-test checklist (needs Richard + a real Supabase project)

Everything in the codebase compiles, type-checks, lints, and passes `npm run
check` (see `docs/E2E.md` for what the browser-tier suite adds on top). The
items below **cannot be verified headless** — they need real devices, a real
network, and a projector. Budget ~30 min for a classroom pass.

This file was rewritten 2026-09-03 alongside the stability program described
in `docs/STABILITY-PROGRAM-2026-09.md` (root causes → fixes → PR numbers) and
the closures logged in `docs/ROBUSTNESS-BACKLOG.md`. The scenarios below are
the manual complement to that program: things only hardware, a real Wi-Fi
network, and a room full of phones can show.

## 0. What the rig no longer needs to prove

The Playwright suite (`docs/E2E.md`) now runs headless against a production
build + real local Supabase, on every PR and nightly. Do **not** re-verify
these by hand — if one of them is actually broken, the CI gate is already red:

| Spec | What it proves |
| --- | --- |
| `e2e/layout-stability.spec.ts` | 12 half-moves: no scrollY/board-box/CLS drift, move list stays pinned (L1/L2) |
| `e2e/reconnect.spec.ts` | offline mid-game and mid-move: rollback, pending ceiling, "reconnecting" badge (R7) |
| `e2e/server-errors.spec.ts` | edge 503/403 HTML vs. our own JSON verdict — session survives edge noise (R1/R3) |
| `e2e/two-tabs.spec.ts` | one identity, several tabs: passive tab, release-on-close (R5) |
| `e2e/game-end.spec.ts` | fool's mate: the result card never moves the board (L2/L3) |
| `e2e/public-flow.spec.ts` | the join flow itself, without the test seam |
| `e2e/lobby-rejoin.spec.ts` | the ghost-sweep's grace window, and the way back in (R4) |
| `e2e/smoke.spec.ts` | two students, two contexts, e4/e5 seen on both boards |

What none of that can do is put a real phone to sleep, project onto an actual
screen, run over a school's actual Wi-Fi, or tell you whether a drag *feels*
right with a finger instead of `page.mouse`. That is what is left below.

## 1. Provision the shared Supabase project

SundayChess does **not** get its own Supabase project. It shares one project
with the other code-identity (non-church-tenant) apps — SundayTicTacToe among
them — the same way `docs/TOURNAMENT-ROBUSTNESS-PLAN.md` describes for
chess/market/turnering/quiz/harvest. Chess's tables live in the **`public`**
schema of that shared project; SundayTicTacToe's live in its own dedicated
`tictactoe` schema on the same project. Neither app touches the other's
schema, and this is **not** the church-tenant `sundayplan` project.

1. Use the existing shared Supabase project (or create one if this is a fresh
   environment — see the sibling apps' `docs/DEPLOY.md` for how the project is
   provisioned). Realtime is enabled by default
   (`supabase/config.toml` → `[realtime] enabled = true`).
2. Apply chess's migrations (these only touch the `public` schema; they never
   collide with `tictactoe` or the other apps' tables):
   ```bash
   supabase link --project-ref <ref>
   supabase db push        # applies supabase/migrations/*, through 0012
   ```
   Or run locally first: `supabase start` (Docker) then `supabase db reset`.
3. Fill `.env.local` from `.env.example`:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server only — never shipped to the client)
   - `NEXT_PUBLIC_BASE_URL=https://chess.sundaysuite.app` (for the join QR)
4. **Migration 0012 (`0012_client_events.sql`) is a prerequisite for §6 below**
   (the Diagnostikk modal). Without it the beacon still answers 204 and
   nothing breaks — the modal just says the table doesn't exist yet.

## 2. Manual scenarios, by device class

Run these with the actual hardware named. A Chromebook borrowed from the
school cart behaves differently from a developer laptop — that's the point.

### Chromebook (student device, the common case)

- [ ] **Board never jumps on move / capture / premove / game end.** Make five
  ordinary moves, one capture, one premove (tap your move before the
  opponent's finishes), and one checkmate. At no point should the board,
  move list, or page scroll position visibly shift — L1–L4/L8 reserved every
  slot around the board and pinned the move list's own scrollbar precisely so
  this can't happen. Watch specifically for the toast (it's `position:
  fixed` now, so it must float over the layout, never push it) and the draw
  offer (it's a modal `ConfirmDialog`, not an inline banner).
- [ ] **Teacher reloads the host page mid-lobby → nobody is removed.** With
  3+ students sitting in the lobby, hard-refresh the host tab. The lobby
  sweep is gated on the host being both `SUBSCRIBED` and visible (R4), so a
  reload must not mass-stamp everyone as "last seen now" and then sweep them
  a moment later — watch the roster for 60+ seconds after the reload; nobody
  should drop off.
- [ ] **Draw offer dialog.** Offer a draw from one board; confirm the
  opponent sees a modal dialog (not a banner they can miss), and that
  accept/decline resolves cleanly on both sides.

### Phone (iPhone and Android — do both if you have them)

- [ ] **Phone locked 4 minutes in the lobby → back in with no action from the
  student.** Join the lobby, lock the phone (side button, not just backgrounding
  the tab), wait 4 minutes, unlock. The host's ghost-sweep will have removed
  the student (their heartbeat, which runs in a Web Worker per R4, stops
  when the OS suspends the tab); on unlock the client auto-calls `POST
  /api/lobby/rejoin` and the student should reappear in the lobby without
  tapping anything. Only if pairings have already started should they instead
  see "Du ble fjernet fra turneringen" and need to rejoin by PIN.
- [ ] **Drag on touch.** Drag a piece with a finger, including a short
  accidental wobble on tap-to-move. `dragActivationDistance: 8` (L4,
  `lib/client/boardOptions.ts`) should absorb a normal tap without either
  starting a phantom drag or feeling sluggish to actually move a piece.
  `touch-action: manipulation` on the board container should mean no
  double-tap-zoom or delayed-tap ghost-click.
- [ ] **Wifi off 30 s mid-game → badge → recovers.** Toggle Airplane Mode for
  30 seconds mid-game, then back on. Expect the "Kobler til igjen …" badge
  after a run of failed background syncs, an "Oppdater" button after 3
  consecutive failures (R7), and the board to resync on its own once the
  network returns — no manual reload required (though the button must work
  if you press it).

### PC / Mac (two browser windows, one player)

- [ ] **Two tabs → "Spill her" → close one → the other takes over in ≤3 s.**
  Open the same player's resume link in two tabs. The second tab should show
  a passive "spill her" prompt (R5, `lib/client/activeTab.ts`) while the
  first stays live. Close the *active* tab (or just its process) — the
  passive tab must take over the board within ~3 s (heartbeat/TTL
  re-election), not hang forever waiting for a `release` that a killed tab
  never got to send.
- [ ] **Solo bot / coach at 4× CPU throttle → no freeze.** Open Chrome
  DevTools → Performance → CPU throttling → 4×, then play a solo game against
  the bot and ask the coach for advice a few times. The engine (Stockfish-ish
  eval + coach hints) runs in a Web Worker (L7+R10, `lib/chess/engine.worker.ts`)
  precisely so this can't block the main thread — the board must keep
  responding to input the whole time.

### Projector (host view)

- [ ] **Eval bar / hype.** With a solo or spectated game up, confirm the eval
  bar updates smoothly (it's fed from the same worker, not the move path) and
  that the win/checkmate confetti and "vant!" banner read clearly from the
  back of a classroom.
- [ ] **Live grid stays legible under load.** With several games live at
  once on the host's live-grid view, confirm boards update without visible
  flicker or reflow (L8, `lib/client/PlayBoard.tsx` — the grid's boards are
  memoized so an unrelated game's move can't re-render the whole grid).

## 2b. Runde 2 scenarios (2026-09-06)

New manual scenarios from the second stability pass (`docs/STABILITY-PROGRAM-2026-09.md`
§"Runde 2") — same rule as above: these need real devices/eyes, not vitest.

### Phone / backgrounded tab

- [ ] **"Din tur" i bakgrunn.** Background the tab (switch app, or lock the
  phone screen without ending the session) while it's your turn and the
  opponent then moves. Foreground again: the tab title should have alternated
  "▶ Din tur! – SundayChess" ↔ the normal title, and — only if you'd already
  tapped 🔔 to opt in — a notification and a short vibration should have
  fired once. Confirm nothing fires if you never tapped 🔔 (no auto-permission
  prompt, ever), and that returning to the tab replays the move sound once.

### Host / projector

- [ ] **Vertskode skjult, "Vis vertskode" reveals it.** Open the lobby on the
  projector: the host/vertskode must not be visible by default. Tap "Vis
  vertskode" — a chip appears with the code and a "Kopier" button, and
  auto-hides again after ~20 s. Confirm a passer-by glancing at the projector
  before that tap sees nothing usable.
- [ ] **Maskerte elevkoder.** Open "Vis koder" (host codes list): every resume
  code should render masked (`••••-••`-style) by default; tapping a row
  reveals only that row's code, with its own "Kopier" button.
- [ ] **Cup-runde tid ute → "Avslutt runden".** In a playoff/cup round, let
  the round timer expire while at least one game is still live. Confirm the
  ⏰ banner and an "Avslutt runden" button appear on `BracketView` (not just
  the league view), and that it's a themed confirm dialog, not a browser
  `confirm()` popup.
- [ ] **"Ta inn igjen" for fraværende elev.** Mark a student "borte" mid-league
  (`OverrideModal`, scope "Ute av turneringen"). Confirm they collapse under
  "Ute av turneringen (n)" in the standings card; expand it, press "Ta inn
  igjen", confirm the dialog. The *current* round stays untouched; the student
  is paired again only from the next round.
- [ ] **"Avslutt etter denne runden".** In an ongoing league (not the last
  round), press the ghost "Avslutt etter denne runden" button next to "Neste
  runde" and confirm. The league should finish (or hand off to the playoff)
  as soon as the round in progress resolves — `config.leagueRounds` must not
  drop below the round just played.
- [ ] **Lærernotat.** Open the ✎ note button next to the tournament title
  (Lobby or League view), type a note (≤280 chars), save. Confirm it shows on
  `HostDashboard`'s tournament card and on the finished screen's print-only
  header — and, on a **student** device, confirm it never appears anywhere
  (the public board endpoint strips it).
- [ ] **Utskrift av resultater.** On the finished screen, press "Skriv ut /
  lagre som PDF". Confirm the print preview shows the full standings + a
  per-round pairings recap in black-on-white, with toolbars/toggles/confetti
  hidden, and that any walkover/absent/override game shows its
  `resultSource` marker instead of looking like a normal result.
- [ ] **Hurtigstart.** From `/arranger`, press "⚡ Rask start" and confirm a
  league (5 rounds, no playoff) is created immediately with an
  auto-generated "Turnering DD.MM" title — no wizard steps shown. Separately,
  step through "Tilpass turnering …" and confirm single-select steps
  (format, variant, playoff on/off, timer, clock, reactions, teams)
  auto-advance ~150 ms after a tap, with "Neste" hidden on those steps.

### Player / waiting room

- [ ] **Venterom viser "Runde n av N · x partier igjen".** With a round live
  and at least one other game still in progress, confirm a waiting/finished
  player's screen shows that exact progress line, falling back to "Venter på
  at arrangøren starter runde n+1" once every game in the round has resolved.

### Draw offer / dialogs

- [ ] **Remistilbud: Escape lukker uten å avslå.** Offer a draw from one
  board; on the other board, press Escape (or click the backdrop). Confirm
  the dialog closes but the offer is still pending (not declined) — a new
  "Svar på remistilbudet" ghost button should appear so the player can
  reopen it. Confirm the explicit "Avslå" button still actually declines.
- [ ] **Tastatur i dialoger (fokusfelle / Escape).** Open any dialog built on
  the shared `Modal` (`ConfirmDialog`, promotion picker, draw offer, result
  overlay). Tab repeatedly and confirm focus cycles only within the dialog
  (never escapes to the page behind it); confirm Escape closes it and focus
  returns to whatever opened it. Open a `ConfirmDialog` **from inside** a host
  modal (nested) and confirm Escape closes only the top one. Confirm the
  promotion picker's Escape **cancels** the pending move rather than silently
  committing a queen.
- [ ] **Reduced-motion (ingen konfetti).** Enable "reduce motion" at the OS
  level (macOS: Accessibility → Display; Android: Settings → Accessibility).
  Reload and win/checkmate a game (host, solo, or versus). Confirm no
  confetti animation plays and the board itself renders without piece-slide
  animation, while the win banner/text still appears.

## 3. Reading the Diagnostikk modal afterwards

After a rig session (or any real one), open the tournament's host page on the
device that created it (the host code lives in that device's `localStorage`)
and press **🩺 Diagnostikk** (top right). See `docs/TELEMETRY.md` for the full
field list; in short:

- **If migration 0012 has not been run**, the modal says "Telemetri-tabellen
  er ikke opprettet ennå — kjør migrasjon 0012 i Supabase-dashbordet." Nothing
  is broken; the beacon has been answering 204 and discarding events the
  whole time. Run the migration and re-test if you want the readout.
- **Counts by event type come first** — that's where the pattern is. What to
  expect from a *healthy* rig session: a handful of `tab_passive` (every
  two-tab test throws one), maybe one or two `channel_error` if you toggled
  Wi-Fi, and otherwise close to zero. What should worry you: `watchdog` (a
  move lock had to be force-freed — investigate which game), a `kick` cluster
  with `reason=resume` spread across many different players (something is
  evicting sessions that shouldn't be), or any `js_error`.
- The **last 200 events** list follows, with clock time, player, and the
  compact detail fields — enough to correlate "the projector froze at 10:42"
  with what the telemetry saw at that timestamp.
- Nothing here has names, IPs, or codes in it (see `docs/TELEMETRY.md` §"Hva
  som IKKE samles inn") — it's safe to read on the projector itself if useful.

## 4. Uptime monitor and the live smoke test

- **Uptime monitor**: `.github/workflows/uptime.yml` probes
  `chess.sundaysuite.app` from GitHub Actions every 10 minutes and files/updates
  a GitHub issue labelled `uptime` on a breach. Run it locally with `npm run
  probe`. This is a synthetic external check, not a substitute for the rig —
  it catches "the site is down," not "the board jumped."
- **Live feature smoke test**: `node scripts/smoke-live.mjs` exercises the
  *deployed* Worker + cloud Supabase directly via the public flow (create →
  join × 2 → round/start), then illegal/out-of-turn rejection, a full game to
  checkmate via `apply_move`, reconnect read, and cloud realtime broadcast
  delivery. It cannot use `/api/dev/quickmatch` — that seam 404s in a
  production build (see §5 below and `docs/E2E.md`). Run it once after any
  production deploy, before or alongside the rig session, to confirm the
  deployed bundle — not just `main` — is the one behaving correctly.

## 5. Core chess flow (still worth a quick manual pass after a deploy)

Use the test seam to spin up a 1v1 without the lobby (local/dev only — see
`docs/E2E.md` on why `E2E_SEAM` must never reach the Worker):

```bash
curl -XPOST http://localhost:3000/api/dev/quickmatch \
  -H 'content-type: application/json' -d '{"white":"Ada","black":"Bo"}'
```

- [ ] Resign and draw-offer/accept resolve the game and update both clients.
- [ ] Rapid double-submit of the same move never corrupts state (the second
      hits `apply_move`'s optimistic FEN check → 409 `stale`).

The core "two tabs play to checkmate," "illegal move rejected," and "resume
after killing a tab" paths are now covered by `e2e/smoke.spec.ts` and
`e2e/lobby-rejoin.spec.ts` — see §0.

## 6. Lobby & league / playoff (spec §1, §6, §7)

- [ ] A 5-round / 9-player league pairs correctly each round with one rotating
      bye, correct standings, and "Neste runde" is gated until all games resolve.
- [ ] Teacher override + "tving fullføring" (force draws) work.
- [ ] An 8-player bracket seeds by (score, Buchholz) and resolves to a single
      winner; a drawn playoff game blocks advance until the teacher overrides it.
- [ ] **Elev markert borte → læreren tar inn igjen → paret neste runde.** Mid-
      league, mark one student's game "borte" with scope "Ute av turneringen"
      (`OverrideModal`). Confirm their board shows `no.player.outOfTournament`
      with the "si fra til læreren" hint. On the host board, the student now
      appears collapsed under "Ute av turneringen (n)" in the standings card
      (`LeagueView.tsx`); expand it and press "Ta inn igjen", confirm the
      dialog ("Fra neste runde blir {navn} paret igjen."). The CURRENT round
      is untouched (they stay out of it), but once the teacher advances to
      the next round the student is paired again like everyone else, and
      their board leaves the waiting/eliminated view on its own (no action
      needed from the student).

## 7. Deploy (see docs/DEPLOY.md)

- [ ] `chess.sundaysuite.app` serves the app; env vars set in the Worker;
      realtime works over the deployed origin.

## Hardening backlog (documented, not blocking — unchanged by this program)

- **Rate limiting** is in-memory/per-process (`lib/server/http.ts`). For a
  multi-instance deploy, move to Upstash/edge KV.
- **Realtime channel authorization**: broadcast/presence channels use the anon
  key with default (open) auth. Tighten with Supabase Realtime Authorization
  (RLS on `realtime.messages`) if classrooms share an origin.
- **Draw offers** are tracked in-process (`lib/server/drawOffers.ts`) — fine for
  single-instance; move to a table if scaled out.
