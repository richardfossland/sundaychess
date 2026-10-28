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
