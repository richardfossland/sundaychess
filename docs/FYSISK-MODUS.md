# Fysisk turneringsmodus (M1)

Lokal-først: en fysisk turnering lever helt i nettleseren (IndexedDB → localStorage → minne), virker uten nett og kaller ingen server. Ingen migrasjoner, ingenting i `lib/server` eller `supabase`.

## Filer

| Fil | Rolle |
|---|---|
| `lib/physical/schema.ts` | Typer, `schemaVersion: 1`. Ren data. |
| `lib/physical/events.ts` | `makeEvent(body, {id?, at?})`, `newId()`, ISO-sjekk. |
| `lib/physical/reducer.ts` | `reduce`, `replay`, `undo`, `dispatch`, `createTournament`, `totalRounds`, `assertCanPair`. All validering, kaster `PhysicalError`. |
| `lib/physical/selectors.ts` | `historyOf`, `standings`, `crosstable`, `colourHistory`, `colourStates`, `nextRoundPairing`, `pairNextRound`, `openRound`, `resultPoints`. |
| `lib/physical/storage.ts` | `PhysicalStore` (indexedDB/localStorage/memory), `openBestStore(env)`, `saveTournament`/`loadTournament`/`listTournaments`/`deleteTournament`, `toStored`/`fromStored`. |
| `lib/physical/roster.ts` | `parseRoster` – innlimt liste / CSV. |
| `lib/physical/errors.ts` | `PhysicalError` med stabil `code` og norsk melding fra `no.physical.errors`. |
| `app/arranger/fysisk/` | `/arranger/fysisk` (liste), `/ny` (veiviser), `/[id]` (minimal oversikt), `usePhysical.ts` (last + autosave). |

Alle strenger ligger i `lib/locale/no.ts` under `physical`. Parring og tiebreaks gjenbrukes fra fase 1 (`lib/tournament/pairing`, `tiebreaks.ts`, `bracket.ts`), ingenting er reimplementert.

## Skjema (v1)

`PhysicalTournament { schemaVersion, id, title, createdAt, status: running|finished, settings, players, rounds, byeRequests, events }`

- `settings`: `system` (monrad|swiss|roundRobin|knockout), `rounds`, `doubleRoundRobin?`, `tiebreaks: TiebreakKey[]` (rekkefølge = prioritet), `byePoints` (1|0.5 for automatisk frirunde), `allowLateEntry`, `groupLabel?` («Klubb»/«Klasse»).
- `players[]`: `id, startNo, name, rating?, club?, status: active|withdrawn, lateEntryRound?`. `startNo` tildeles i påmeldingsrekkefølge og gjenbrukes aldri.
- `rounds[]`: `number, status: draft|published|completed, pairings[]`. En parring: `board, white, black|null, byeType?, result?, resultSource?: 'arbiter', rematch?, manual?`.
- `result`: `'1-0' | '0-1' | '½-½' | '+-' | '-+' | '='`. `+-`/`-+` er walkover (forfeit: teller poeng, ikke «har møttes» eller farge). `=` er begge uteble (0–0).
- `byeRequests[]`: `{playerId, round, byeType: 'half'|'zero'}` for ikke-parrede runder.
- Utslag: `board = brakettplass + 1` (frirunder i runde 1 ligger på sin plass, ikke sist). `settings.rounds` er informativ for alle-mot-alle/utslag; bruk **`totalRounds(t)`**.

Lagret form (`StoredTournament`): bare `events` + metadata til listevisning. State bygges alltid ved `replay(events)` – avledet state lagres aldri.

## Hendelser

Alle har `id` (unik i loggen) og `at` (ISO 8601).
`createTournament`, `addPlayer`, `editPlayer`, `withdrawPlayer`, `reinstatePlayer`, `requestBye`, `cancelByeRequest`, `pairRound`, `manualPairing`, `swapPairing`, `publishRound`, `setResult`, `clearResult`, `completeRound`, `finishTournament`.

- `pairRound` lagrer de ferdig beregnede parringene i hendelsen. Replay kaller ALDRI parringsmotoren, så gamle turneringer er deterministiske selv om motoren endres. Motoren kalles bare av `nextRoundPairing`/`pairNextRound` (UI-laget) før hendelsen dispatches.
- `undo` = fjern siste hendelse og `replay` (opprettelsen kan ikke angres). `finishTournament` kan angres.
- Reduceren muterer aldri inndata; ugyldig hendelse kaster og state er uendret.

## Invarianter (håndheves i reduceren)

1. Første hendelse er `createTournament`; kun én.
2. Runde `n` kan bare pares når runde `n-1` er `completed`, og `n ≤ totalRounds`.
3. I Monrad/sveitsisk/alle-mot-alle står hver aktive spiller nøyaktig én gang per runde; trukne spillere aldri. I utslag er trukne spillere tillatt i brakett (arrangør gir walkover).
4. Ønsket bye for runden må finnes som bye med samme type i parringen.
5. Utkast (`draft`) kan overstyres (`manualPairing`/`swapPairing`); `publishRound` låser parringene. Resultater kan bare føres i `published`; `completeRound` krever resultat på alle brett og låser runden.
6. Frirunder har ikke resultat (poeng følger `byeType`: full=1, half=½, zero=0).
7. Utslag: ikke `½-½` eller `=`.
8. Sen påmelding: bare Monrad/sveitsisk og `allowLateEntry`; `lateEntryRound = rounds.length + 1`. Tidligere runder teller som 0 (fravær) i tiebreaks (FIDE C.07 art. 16).
9. Etter `finishTournament` avvises alle hendelser (bortsett fra `undo`).

## Parring

`nextRoundPairing(t)` bygger `PairingInput` fra fullførte runder (`historyOf`) og `standings` (poeng + Buchholz), og kaller `pairRound(system, …)`. Alle-mot-alle får ALLE spillere (også trukne) siden tabellen er statisk. `byePoints = 0.5` gjør automatiske frirunder (ikke walkover i alle-mot-alle) til `half`. Utslag bruker `buildFirstRound`/`nextRound` fra `bracket.ts` med seeding etter rating (synkende), så startnummer.

## Utvidelsespunkter

- **M2 (runde-skjerm):** bruk `usePhysicalTournament` (`apply(body)`, `run(fn)`, `undo`) og selectors. Parringstabellen i `[id]/PhysicalBoard.tsx` er bevisst enkel; bytt den ut. `manualPairing`/`swapPairing`/`cancelByeRequest` finnes allerede i reduceren, bare uten UI. Auto-publisering eller «publiser»-lås er en ren UI-beslutning. Åpent: hvordan en senpåmeldt spiller får ½-poeng for tapte runder (nå 0), og walkover-snarvei når en spiller trekkes i en åpen runde.
- **M3 (utskrift/storskjerm):** les kun via selectors (`standings`, `crosstable`, `colourHistory`, `openRound`). Ingen nye hendelser trengs.
- **M4 (fil, TRF16, CSV):** eksport = `{schemaVersion, hash, ...toStored(t)}`; import = valider `schemaVersion`, hash, deretter `replay(events)` (reduceren avviser ugyldige logger med norske meldinger). Utled TRF16/CSV fra `historyOf`/`standings`. Resultatkoder er allerede mappet i `GAME_RESULT` (selectors.ts).
- **M5 (sky):** `result_source ∈ {arbiter, player_report}` – feltet `resultSource` finnes (`'arbiter'`); utvid unionen og lag en hendelse for godkjent spillerrapport. Hendelses-`id` er idempotensnøkkel. Skjema-bump krever en `migrate(v1)`-funksjon før `replay`.
- **M6 (PWA):** `/arranger/fysisk` og `/ny` er rene klientsider uten serverkall; `getStore()` er det eneste lagringsinngangspunktet.
