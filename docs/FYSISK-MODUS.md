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
| `app/arranger/fysisk/` | Én catch-all-side `[[...slug]]` → `PhysicalApp` (klient) som velger visning fra `window.location`: liste, `/ny` (veiviser), `/<id>` (`PhysicalBoard`, minimal oversikt). `nav.tsx` navigerer med `history.pushState` (ingen RSC-henting), slik at PWA-skallet (`/arranger/fysisk`) virker for alle stier uten nett. `usePhysical.ts` = last + autosave. Ingen serverdata på disse sidene. |

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

## Fil, TRF16 og CSV (M4)

Alt skjer i nettleseren (Blob), uten nett. UI: `FileMenu.tsx` («Fil»-menyen i turneringshodet) og `ImportFile.tsx` («Åpne turneringsfil» i listen).

| Fil | Rolle |
|---|---|
| `lib/export/json.ts` | `.sundaychess.json`: `{format:"sundaychess-tournament", schemaVersion, exportedAt, app, tournament:{id,title,createdAt,events,snapshot}, sha256}`. `events` er sannhetskilden, `snapshot` er avledet (kun lesbarhet + kryssjekk). `sha256` = SHA-256 over kanonisk JSON (sorterte nøkler) av `events`. |
| `lib/export/hash.ts` | `canonicalJson`, `sha256Hex` (WebCrypto, med ren JS-fallback på usikre kontekster). |
| `lib/export/download.ts` | `downloadBlob`: skjult `<a download>`; uten `download`-støtte (eldre iOS Safari) åpnes blob-URL i ny fane. |
| `lib/export/trf16.ts` | TRF16 (FIDE C.04 Annex 2). |
| `lib/export/csv.ts` | Stilling og partier. |
| `lib/import/parse.ts` | `parseTournamentFile`: format → `schemaVersion` (+ `migrate.ts`-krok) → hash → replay gjennom reduceren (feil oppgis som «Hendelse nr. N …») → kryssjekk av `snapshot` → varsel om umerkede gjentatte parringer. |
| `lib/import/apply.ts` | `classifyConflict` (none/same/localNewer/fileNewer/diverged, på hendelses-id), `asNewCopy` (ny turnerings-id + « (kopi)»), `saveImported`. |

**Import-regler.** Hash-avvik eller avvikende snapshot → advarsel «filen er endret utenfor appen», og importen er sperret til brukeren huker av «importer likevel». Hash sjekkes mot loggen slik den står i fila, FØR en eventuell migrering. Finnes samme turnerings-id lokalt: «Erstatt», «Behold begge (ny kopi)» eller avbryt; har den lokale kopien flere hendelser som utvider filens logg, står det at lokal kopi er nyere.

**TRF16.** Kolonner (1-basert): `001` 1–3, startnr 5–8, kjønn 10, tittel 11–13, navn 15–47 (`Etternavn, Fornavn`, best effort: siste ord = etternavn), rating 49–52, forbund 54–56, FIDE-nr 58–68, fødselsdato 70–79, poeng 81–84 (`11.5`), plassering 86–89, deretter 10-tegns blokk per runde fra kol. 90: motstander 92–95, farge 97 (`w`/`b`/`-`), resultat 99. Resultatkoder: `1`/`0`/`=` spilt; `+`/`-` walkover; `=` (begge uteble) → `-` for begge; frirunde → motstander `0000`, farge `-`, kode `U` (full, tildelt av parringen), `H` (halv), `Z` (null/fravær). Spillere som ikke er satt opp i en runde (trukket, utslått, senpåmeldt) får `0000 - Z`. Bare fullførte runder tas med. Headerlinjer 012/022/032/042/052/062/072/092/102/122 (by, arbitrer og betenkningstid er tomme med mindre de gis som `Trf16Options`; forbund = `NOR`). Linjer slutter med CRLF (Remark 1: CR).
*Tegnsett:* spesifikasjonen sier ikke noe om koding, og bbpPairings/JaVaFo teller kolonner i byte. Æ/Ø/Å ville forskjøvet alle kolonner i UTF-8, så navnene translittereres til ren ASCII (æ→ae, ø→oe, å→aa, é→e …).
*Validering (eier):* bbpPairings er ikke tilgjengelig via npm/pip, så den er ikke i CI. Last ned bbpPairings og kjør `bbpPairings.exe --dutch fil.trf -c` (bruk `trf16Text(t, { xxr: true })` hvis programmet krever `XXR`-linjen med antall runder), eller åpne fila i Swiss-Manager/Vega. Enhetstesten sjekker kolonnene mot en håndkontrollert golden-fil.

**CSV.** UTF-8 med BOM, `;` som skilletegn, CRLF, desimalkomma (norsk Excel). Tabell: `#;Nr;Navn;Klubb/klasse;Rating;Poeng;<tiebreaks>`. Partier: `Runde;Brett;Hvit;Svart;Resultat`. Tekstceller som begynner med `= + - @` får `'` foran (formelinjeksjon).

**Tester.** `test/export/*` (rundtur-egenskapstest på 60 tilfeldige turneringer, tukling, versjon/migrering, konflikter, TRF- og CSV-golden, nedlasting) og `e2e/physical-file.spec.ts` (eksport → slett → importer → neste runde, offline).
