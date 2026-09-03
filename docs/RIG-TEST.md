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

## 1. Provision the dedicated Supabase project

Per the plan, SundayChess uses its **own** Supabase project (not the
church-tenant `sundayplan`).

1. Create a new Supabase project (e.g. `sundaysjakk`). Realtime is enabled by
   default (`supabase/config.toml` → `[realtime] enabled = true`).
2. Apply the migrations:
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
  *deployed* Worker + cloud Supabase directly (quickmatch, illegal/out-of-turn
  rejection, a full game to checkmate via `apply_move`, reconnect read, and
  cloud realtime broadcast delivery). Run it once after any production deploy,
  before or alongside the rig session, to confirm the deployed bundle — not
  just `main` — is the one behaving correctly.

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
