# Migrasjon 0017: «Fortsett digitalt» (M5b)

Kjøres for hånd i **SQL-editoren** (supabase-CLI SIGKILL-er). Additiv og idempotent; trygg å kjøre flere ganger.
Supabase-prosjektet er DELT: bare `public.games` og `public.players` (chess) røres.

## Rekkefølge (bindende)
1. **Migrasjonen FØRST** (`supabase/migrations/0017_physical_continue.sql`). Gammel kode ignorerer de nye kolonnene.
2. Kode ETTERPÅ (deploy fra `wt/<app>-deploy` med `nvm exec 22`). `PAIR_SECRET` må være satt (som for 0014–0016).
3. Deployes koden før 0017: `POST /api/tournament/from-physical`, navnevalg (`/api/join/names`, `/api/join/claim`) og nullstilling feiler med 503; resten av appen er upåvirket.

## Hva den gjør
- `games_result_source_check` utvides med `'physical'` (resultat ført over brettet).
- `players`: `rating int`, `club text`, `start_no int` (unik per turnering når satt), `pre_registered boolean default false`, `claimed_at timestamptz`.
- `claim_player(p_tournament_id, p_player_id)`: atomisk krav; setter `claimed_at` bare hvis navnet er ledig. Kun `service_role`.
- `recompute_scores` er uendret: ½-frirunde lagres som `black_player_id = null` + status `draw`, 0-frirunde som `aborted`, full frirunde som `bye`.

## Sjekkliste etter SQL
```sql
select pg_get_constraintdef(oid) from pg_constraint where conname = 'games_result_source_check';  -- inneholder 'physical'
select column_name from information_schema.columns where table_name = 'players' and column_name in ('rating','club','start_no','pre_registered','claimed_at'); -- 5 rader
select has_function_privilege('anon', 'public.claim_player(uuid,uuid)', 'execute');  -- false
```
- [ ] Alle sjekkene stemmer.

## Før migrasjonen er kjørt (gammel DB, ny kode)
- `POST /api/tournament/from-physical`, `POST /api/join/claim` og `POST /api/lobby/reset-claim` svarer 503 (manglende kolonner/funksjon).
- `POST /api/join/names` svarer 200 med **tom liste** (`pre_registered` finnes ikke i radene) og eleven faller tilbake til vanlig navneinntasting. Ingen tournaments fra `from-physical` kan finnes uten migrasjonen.
- Resten av appen er upåvirket.

## Tilbakerulling
Bare trygt når ingen turnering er opprettet via «Fortsett digitalt» (ellers mister de rating/klubb/startnummer og får ulovlige `physical`-kilder). Kjør i SQL-editoren:

```sql
drop function if exists public.claim_player(uuid, uuid);
drop index if exists public.players_tournament_start_no_idx;
alter table public.players drop column if exists claimed_at;
alter table public.players drop column if exists pre_registered;
alter table public.players drop column if exists start_no;
alter table public.players drop column if exists club;
alter table public.players drop column if exists rating;
update public.games set result_source = 'teacher_override' where result_source = 'physical';
alter table public.games drop constraint if exists games_result_source_check;
alter table public.games add constraint games_result_source_check
  check (result_source in ('play','teacher_override','bye','timeout_draw','walkover','opponent_absent'));
```
Rull tilbake KODEN først (eller samtidig); ny kode forventer kolonnene.
