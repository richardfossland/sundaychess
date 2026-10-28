# Migrasjon 0016: fysisk turnering i skyen (M5a)

Supabase CLI SIGKILL-er på denne maskinen, så migrasjonen kjøres for hånd i
**SQL-editoren** (Dashboard → SQL Editor). Den er additiv og idempotent
(`create table if not exists`, `create or replace`, `do $$ … cron.unschedule`) og
trygg å kjøre FØR ny kode deployes: ingen eksisterende tabeller, funksjoner eller
policyer endres.

> Supabase-prosjektet er DELT med andre Sunday-apper. Alt her ligger i schema
> `public` med prefikset `physical_` og rører ikke andre apper (TTT bor i
> schema `tictactoe`). `cleanup_old_tournaments()` fra 0013 er IKKE endret, så
> revoke/grants derfra står urørt.

## Rekkefølge (bindende)

1. **Migrasjonen FØRST** (denne filen, SQL-editoren). Gammel kode ignorerer den.
2. **`PAIR_SECRET`** må være satt som Worker-secret (den ble innført for 0014/0015;
   sjekk at den finnes). Uten den virker publisering, men pair-token og bordnøkler
   (QR) er slått av: `POST /api/physical/*/report` og `/keys` svarer
   `503 reports_unavailable`, og bordkortene får ingen QR.
3. **Kode ETTERPÅ** (deploy Worker fra `wt/<app>-deploy` med `nvm exec 22`).
4. Røyktest + sjekkliste under.

**Deploy aldri koden før 0016 er kjørt:** publisering feiler da med 503.

## 1. SQL

Lim inn hele `supabase/migrations/0016_physical_cloud.sql` og trykk Run. Den lager:

- `public.physical_tournaments` (`id uuid pk` = skyens id, normalt lik lokal
  turnerings-id, `host_code`, `title`, `event_log jsonb`, `log_version`, `log_hash`,
  **`public_snapshot jsonb`** (avledet offentlig visning, beregnet ved publisering/PUT; offentlig GET og
  rapport-POST leser den og spiller aldri av loggen), **`public_names ∈ full|initials`**
  (standard `initials`), **`local_id uuid`** (turnerings-id inne i loggen når den avviker fra `id`, se
  «id-kollisjon»), `updated_at`, `created_at`)
- `public.physical_result_reports` (`tournament_id` → `on delete cascade`, `round`,
  `board`, `result ∈ 1-0|0-1|½-½`, `reporter ∈ white|black|unknown`, `request_id`
  UNIQUE, **`device_id`** (tilfeldig id fra melderens telefon), **`pairing_fp`**
  (`<hvit-id>|<svart-id>` fra `public_snapshot` da meldingen kom),
  `status ∈ pending|approved|rejected|superseded`, `created_at`, `decided_at`)
- RLS PÅ, **ingen policyer**, `revoke all from anon, authenticated`, grant kun til
  `service_role` (som alle andre chess-tabeller).
- `public.cleanup_physical_tournaments()` (security definer, kun `service_role`):
  sletter turneringer uten **arrangøraktivitet** på 30 dager (`updated_at`; spillermeldinger
  forlenger IKKE oppbevaringen; rapportene følger med via cascade). Planlagt daglig 05:00 som cron-jobben `cleanup-physical-tournaments`
  (`cleanup-old-tournaments` går 04:00 og er urørt).

### Verifiseringssjekkliste (etter SQL, før deploy)

```sql
select to_regclass('public.physical_tournaments'), to_regclass('public.physical_result_reports');  -- begge ikke-null
select relrowsecurity from pg_class where relname in ('physical_tournaments','physical_result_reports'); -- t, t
select count(*) from pg_policies where tablename like 'physical_%';                               -- 0
select has_table_privilege('anon', 'public.physical_tournaments', 'select');                      -- false
select has_function_privilege('anon', 'public.cleanup_physical_tournaments()', 'execute');        -- false
select jobname, schedule from cron.job where jobname like 'cleanup-%';                            -- to rader
select public.cleanup_physical_tournaments();                                                      -- 0 (som service_role)
```

- [ ] Alle sjekkene over stemmer.
- [ ] `cleanup_old_tournaments` er fortsatt ikke kjørbar for anon (0013): `has_function_privilege('anon','public.cleanup_old_tournaments()','execute')` = false.

### Røyktest etter deploy

1. Fysisk modus → ny turnering → Par runde 1 → Publiser runde → **Sky → Publiser til sky**. Status skal bli «Synkronisert».
2. Åpne den offentlige lenken på en annen enhet: parringer og tabell vises, ingen arrangørkode i kilden.
3. Skriv ut **Bordkort**: QR-kode på hvert kort. Skann én med telefonen → rapportside → «Hvit vant» → Send.
4. På arrangørens enhet dukker meldingen opp (≤ 10 s) → Godkjenn → resultatet står i tabellen og på den offentlige siden.
5. Sky → Avpubliser: den offentlige siden gir «Fant ikke turneringen».

### Endringer etter Opus-gjennomgangen (fase 2)

Migrasjonen er redigert på plass (0016 var ikke kjørt i prod), fortsatt idempotent
(`add column if not exists`, `create or replace`). Er en tidligere versjon av 0016 allerede kjørt et sted
(f.eks. lokal Supabase), kjør hele fila på nytt: kolonnene legges til, men `check`-begrensningen på
`status` (`superseded`) må da byttes manuelt:

```sql
alter table public.physical_result_reports drop constraint if exists physical_result_reports_status_check;
alter table public.physical_result_reports add constraint physical_result_reports_status_check
  check (status in ('pending', 'approved', 'rejected', 'superseded'));
```

**Ingen ny tabell for publiseringsgrensen.** Maks 10 publiseringer per IP per døgn telles i den
eksisterende `code_attempts` (0015) med scope `publish` via `register_code_failure(p_window_s => 86400)`.
Hvert publiseringsforsøk teller (også ugyldige), og telleren feiler åpent som resten av 0015.

Ekstra sjekk etter SQL:

```sql
select column_name from information_schema.columns
 where table_name = 'physical_tournaments' and column_name in ('public_snapshot','public_names','local_id'); -- 3 rader
select column_name from information_schema.columns
 where table_name = 'physical_result_reports' and column_name in ('device_id','pairing_fp');                 -- 2 rader
```

## Rollback

Koden fungerer uten tabellene bare ved at «Publiser» feiler (turneringen er lokal og urørt). Rull tilbake i denne rekkefølgen:

1. Deploy forrige Worker-versjon (ingen kode leser tabellene uten «Publiser»).
2. Deretter, hvis ønskelig:

```sql
select cron.unschedule('cleanup-physical-tournaments');
drop function if exists public.cleanup_physical_tournaments();
drop table if exists public.physical_result_reports;
drop table if exists public.physical_tournaments;
```

Å droppe tabellene sletter alle publiserte turneringer i skyen (lokale kopier i
nettleserne er uberørt, og kan publiseres på nytt).

## Hva som lagres

`event_log` er nøyaktig den samme kanoniske hendelsesloggen som i
`.sundaychess.json` (jf. `docs/FYSISK-MODUS.md`), validert ved opplasting ved å
spille den av gjennom reduceren (`lib/physical/reducer.ts`, O(n)). **Grenser: maks 500 spillere,
5 000 hendelser, 512 KB**; sjekket i klienten (vennlig feil) og på serveren FØR avspilling
(rå kroppsstørrelse → 413 `payload_too_large`; antall → 422 `too_many_events`/`too_many_players`).

**Personvern.** Spillernavn og resultater er personopplysninger om barn. Den offentlige siden viser som
standard bare «Ola N.» (fornavn + initial) og ingen klubb/klasse (`public_names = 'initials'`); arrangøren
kan velge fulle navn ved publisering. Selve `event_log` (fulle navn) leses bare av arrangøren (`GET …/log`).
Raden slettes ved «Avpubliser», og automatisk etter 30 dagers arrangør-inaktivitet.
