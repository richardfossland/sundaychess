# SundayChess – kvalitetsoppgradering + fysisk turneringsmodus

## Context
SundayChess (chess.sundaysuite.app, repo `~/sunday-work/sundaychess`, Next 16 + OpenNext/Cloudflare + Supabase) har allerede klasseturnering (greedy Monrad + utslag/cup), solo mot bot, coach, puzzles, 89 vitest + 10 Playwright. Men:
- Alle partier MÅ spilles i motoren – ingen måte å kjøre partier over brettet og bare føre resultater.
- Ingen eksport/import av turnering, ingen PGN/TRF/CSV, ingen PWA/offline.
- Parring er «ikke FIDE-perfekt» greedy Monrad, eneste tiebreak er Buchholz, ingen alle-mot-alle.
- Realtime-kanaler er ikke autorisert, rate-limit er per isolate.
- SundayTurnering har siden 09-22 fått en lang rekke modne mønstre (stabilitet, privat Realtime, offline-outbox, utskrifter m/QR, Storskjerm, blossom-sveitsisk, konfigurerbare tiebreaks, designtokens) som chess mangler.

**Mål:** gjøre chess til et fullverdig turneringsverktøy for skole, klubb og menighet. Det skal kunne kjøre fysiske turneringer offline, lagre dem som fil og fortsette dem digitalt senere. Samtidig skal grunnkvaliteten løftes til Turnering-nivå.

**Avklart med eier (10-27):**
- Målgruppe: skole, klubb og menighet.
- Parring: Monrad, sveitsisk, alle-mot-alle og utslag.
- Resultater i fysisk modus: arrangøren fører, og spillerne kan melde via QR med godkjenning.
- Eksport: fil + offline-først.

## Arbeidsform
- Én **Sonnet-agent per PR**, i eget worktree, som committer og pusher underveis.
- **Én Opus-review per fase** (mønsteret fra turnering, se `feedback_sonnet_first_one_opus_review`).
- Rene `lib/`-moduler skrives test-først med vitest. Migrasjoner testes i PGlite, slik turnering gjør (`test/*-migration.test.ts`).
- Main-grenen er beskyttet med påkrevde sjekker. Vent til hele CI-kjøringen er ferdig før merge, og bruk aldri `--auto` rett etter force-push.
- Deploy skjer manuelt etter hver fase. Oppskriften er `docs/DEPLOY.md` + `reference_opennext_safe_deploy`:
  - rent worktree på `origin/main` med `nvm exec 22`
  - skann `next-env.mjs` for nøkler
  - røyktest før og etter deploy
- Migrasjoner nummereres fra **0014**. ⚠️ `public.tournaments` = chess sin tabell i en delt DB.

---

## Fase 0 – Fundament (port fra Turnering)
| PR | Innhold | Kilde i turnering |
|---|---|---|
| F0a | Robusthet: `withApi` (DB-feil → 503), klient-timeouts (8 s GET / 15 s skriv), `error.tsx`/`global-error.tsx`, `OfflineBanner`, `useWakeLock`, sikkerhetsheadere | `lib/server/http.ts`, `lib/client/*` (#50–#55) |
| F0b | Privat Realtime: `private:true`, RLS per topic på `realtime.messages` + GRANTs, `to_regclass`-vakt (migr 0014). Kode-misbruk: `code_attempts`, `register_code_failure` og HMAC-parringstoken (`PAIR_SECRET`) i stedet for limiter per isolate | migr 0010/0011, `lib/server/pair.ts`, `lib/realtime.ts` |
| F0c | Design: semantiske `--s-*`/`--k-*`-tokens, mørk/lys-tema uten blink, Lucide-ikoner, `NumberField`/`numberDraft` | `app/globals.css`, `lib/client/Icon.tsx`, D0–D7 |

Legacy offentlig kanal beholdes én slippsyklus, slik som i turnering.

## Fase 1 – Turneringsmotor (rene funksjoner, ingen UI)
Ny mappe `lib/tournament/pairing/` med felles grensesnitt `pair(state, round) → Pairing[]`. Fargetildeling og bye-regler ligger i ett felles lag.

| PR | Innhold |
|---|---|
| P1 | Refaktorer `pair.ts` til en **Monrad etter NSF-regler**: poenggruppe → startnummer, ingen gjentatt motstander, fargebalanse (maks 2 like på rad, differanse ≤ 2), bye til lavest rangerte uten tidligere bye. Eksisterende oppførsel bevares bak de samme testene |
| P2 | **Alle-mot-alle**: Berger-tabeller (FIDE), enkel og dobbel runde |
| P3 | **Sveitsisk**: port `swiss.ts` + `lib/vendor/edmonds-blossom.js` (MIT) fra turnering, og legg til fargefloater og rating-seeding. Merkes i UI som «Sveitsisk (FIDE-inspirert)». Ekte FIDE Dutch via bbpPairings-WASM er en senere opsjon, bare hvis vi får NSF-ratede turneringer |
| P4 | **Tiebreaks**: konfigurerbar rekkefølge (port `standings.ts`) med Buchholz, Buchholz cut-1, Sonneborn-Berger, innbyrdes oppgjør, antall seire og progressiv. Bye telles som virtuell motstander (FIDE 13.15.2). Hver tiebreak får en forklaring i UI |
| P5 | Utslag: gjenbruk `bracket.ts` for fysisk modus (resultat-only, manuell vinner ved remis/armageddon) |

Alt testes med golden-fixtures, inkludert eksempler fra NSF-regelheftet og Sjakkskolen.

## Fase 2 – Fysisk turneringsmodus (kjernen)
**Arkitektur: lokal-først.** En fysisk turnering lever som et rent hendelseslogg-objekt i nettleseren (IndexedDB med localStorage-fallback, mønster fra `outbox.ts`):
- `lib/physical/state.ts` er en ren reducer over hendelser: `addPlayer`, `withdraw`, `requestBye`, `pairRound`, `setResult`, `undo` og så videre.
- Turneringen virker 100 % uten nett. Angre og revisjonslogg følger gratis av hendelsesloggen.
- Motoren fra fase 1 brukes direkte på klienten.

| PR | Innhold |
|---|---|
| M1 | `lib/physical/` (state, reducer, lagring, skjema v1) + veiviser «Fysisk turnering» på `/arranger`. Veiviseren tar format, antall runder, tiebreaks og spillerliste (lim inn/CSV, klasse/klubb, valgfri rating) |
| M2 | Arrangørens runde-skjerm: parringstabell med bordnummer og trykk-for-resultat (1-0 / ½-½ / 0-1 / walkover / bye), angre, «publiser runde»-lås. Støtter sen påmelding, trekk og ønsket bye (½/0). Tabell og krysstabell vises live |
| M3 | Utskrifter (print-CSS, port `printout.ts`): parringsliste, bordkort med QR, resultatlapper, krysstabell, sluttresultat og diplom. **Storskjerm**-visning i eget vindu (`boardWindow.ts`-mønster) med parring, tabell og nedtelling |
| M4 | **Fil:** last ned `*.sundaychess.json` (schemaVersion, sha-256-hash, innstillinger, spillere, runder, hendelseslogg). Last opp med validering: hash, gjentatte parringer, poengsum mot resultater, vennlige feilmeldinger. Ekstra eksporter: **TRF16** (for Swiss-Manager/Vega/NSF) og **CSV** |
| M5 | **Til sky / fortsett digitalt:** «Publiser» laster turneringen opp til Supabase (migr 0015). Det gir: |
|    | • `tournaments.config.mode = physical\|digital\|mixed`, `games.result_only`, `result_source ∈ {arbiter, player_report}` |
|    | • tabellen `result_reports`: spilleren skanner QR på bordkortet → melder resultat → arrangøren godkjenner. Idempotent `request_id`, offline-outbox fra turnering |
|    | • **valg per runde: fysisk eller digital.** Digitale runder bruker eksisterende spillflyt (`startLeague`/`advanceRound`), og importerte spillere «gjør krav på» navnet sitt med PIN og får `resume_code` |
|    | • eksport tilbake til fil når som helst, slik at sky og fil er toveis |
| M6 | **PWA:** manifest + service worker (app-skall og `/arranger/fysisk` cachet), slik at fysisk modus åpnes uten nett etter første besøk |

## Fase 3 – Spillkvalitet (digitalt)
| PR | Innhold |
|---|---|
| Q1 | PGN-eksport per parti og per turnering (med Round/Board-tagger), FEN-kopi, PGN-import til analyse |
| Q2 | Barnevennlig og tilgjengelig: valgfri trekkbekreftelse, oppgivelse med bekreftelse, tastatur- og skjermleser-modus med opplesning av trekk, høykontrast og brett/brikketemaer |
| Q3 | Skole: grupper per klasse/skole, lagtabell per skole, diplomer (gjenbruk `awards.ts`) |
| Q4 *(valgfri)* | Stockfish-WASM i worker for analyse etter partiet, i stedet for/i tillegg til egen negamax |

## Fase 4 – Kvalitetssikring
- Opus-review per fase, med fiks-PR for 🔴/🟠.
- Playwright-e2e for fysisk modus:
  - lag turnering → 3 runder → eksporter → slett lokalt → importer → publiser → QR-rapport → godkjenn → digital runde → eksporter igjen
  - en offline-test (Playwright `context.setOffline(true)`) som verifiserer at M1–M4 virker uten nett
- `docs/RIG-TEST.md` utvides med fysisk modus (ekte telefoner, projektor og skriver). Riggtesten gjør eieren.

## Verifisering
- `npm run lint && npm run typecheck && npx vitest run` i hver PR, med golden-tester for parring og tiebreak.
- TRF16-eksporten valideres ved å åpne den i bbpPairings (`--check`) eller Swiss-Manager.
- Rundtur-test: `import(export(state))` skal være dypt lik for tilfeldige turneringer (property-test).
- Etter hver fase: deploy etter oppskriften, og røyktest av `/`, `/arranger`, `/api/health` før og etter.

## Kritiske filer
- Endres: `lib/tournament/{pair,score,bracket}.ts`, `lib/server/{league,store,auth}.ts`, `lib/realtime.ts`, `app/arranger/Wizard.tsx`, `app/host/[tournamentId]/*`, `lib/types.ts`, `lib/dto.ts`, `lib/locale/no.ts`.
- Nye: `lib/tournament/pairing/*`, `lib/tournament/tiebreaks.ts`, `lib/physical/*`, `lib/export/{json,trf16,csv,pgn}.ts`, `app/arranger/fysisk/*`, `supabase/migrations/0014_*`, `0015_*`.
- Portes fra `~/sunday-work/sundayturnering`: `lib/tournament/{swiss,standings,printout}.ts`, `lib/vendor/edmonds-blossom.js`, `lib/client/{outbox,channelRegistry,refetch,OfflineBanner,Icon}.ts(x)`, `lib/server/pair.ts`, migr 0010/0011/0015 (mønstre).

## Rekkefølge og omfang
Fase 0 → 1 → 2 → 3, totalt ~20 PR-er. Fase 1 og fase 0 kan gå parallelt, siden de har ulike filer. M1–M4 kan leveres før M5, så fysisk modus offline + fil er brukbar tidlig.

## Åpne punkter (avklares underveis, blokkerer ikke)
- Om NSF vil ha TRF16 for ratingrapportering. Det sjekkes før vi lover «ratet turnering».
