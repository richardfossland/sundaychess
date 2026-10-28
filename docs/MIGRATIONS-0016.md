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

- `public.physical_tournaments` (`id uuid pk` = lokal turnerings-id, `host_code`,
  `title`, `event_log jsonb`, `log_version`, `log_hash`, `updated_at`, `created_at`)
- `public.physical_result_reports` (`tournament_id` → `on delete cascade`, `round`,
  `board`, `result ∈ 1-0|0-1|½-½`, `reporter ∈ white|black|unknown`, `request_id`
  UNIQUE, `status ∈ pending|approved|rejected`, `created_at`, `decided_at`)
- RLS PÅ, **ingen policyer**, `revoke all from anon, authenticated`, grant kun til
  `service_role` (som alle andre chess-tabeller).
- `public.cleanup_physical_tournaments()` (security definer, kun `service_role`):
  sletter turneringer uten aktivitet på 30 dager (rapportene følger med via
  cascade). Planlagt daglig 05:00 som cron-jobben `cleanup-physical-tournaments`
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
spille den av gjennom reduceren (`lib/physical/reducer.ts`). Maks 20 000 hendelser /
4 MB. Spillernavn og resultater er personopplysninger om barn: raden slettes ved
«Avpubliser», og automatisk etter 30 dagers inaktivitet.
