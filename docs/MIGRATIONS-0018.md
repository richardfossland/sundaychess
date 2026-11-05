# Migrasjon 0018: atomiske runder + RPC-lås (H1, M6)

Kjøres for hånd i **SQL-editoren** (supabase-CLI SIGKILL-er). Additiv og idempotent; trygg å kjøre flere ganger.
Supabase-prosjektet er DELT: bare chess-tabellene (`tournaments`, `rounds`, `games`, `players`) og chess-funksjonene røres.

## Rekkefølge (bindende)
1. **Migrasjonen MÅ kjøres FØR deploy** (`supabase/migrations/0018_atomic_rounds_lockdown.sql`).
2. Kode ETTERPÅ (deploy fra `wt/<app>-deploy` med `nvm exec 22`).
3. Deployes koden før 0018: «Start turnering», «Neste runde» (liga og sluttspill) og cup-start feiler med 500 (`start_round` finnes ikke). Spill, trekk og resten av appen er upåvirket. Det er ingen fallback til gammel oppretting med vilje: den var årsaken til de halvbygde rundene.

## Hva den gjør
- `start_round(p_tournament_id, p_number, p_phase, p_prev_round_id, p_games jsonb, p_set_status)`: i ÉN transaksjon låses turneringsraden, forrige runde settes `done`, runden opprettes, ALLE partier settes inn (frirunder med status/result_source som før), `current_round` (og evt. `status`) flyttes og `recompute_scores` kjøres. Feiler noe, rulles alt tilbake: ingen halvbygd runde.
- Finnes runden fra før svarer den `conflict='exists'` med `complete` (har partier og er turneringens aktive runde). Ruten svarer 200 på dobbeltklikk bare når `complete=true`; ellers `409 round_incomplete`.
- M6: `apply_move`, `resolve_game` (4 argumenter), `recompute_scores`, `extend_round`, `join_team_player` og `start_round` får `revoke ... from public, anon, authenticated` og `grant execute ... to service_role`. Serveren bruker bare service_role; nettleseren bruker bare Realtime.

## Sjekkliste etter SQL
```sql
select has_function_privilege('anon', 'public.start_round(uuid,int,text,uuid,jsonb,text)', 'execute');         -- false
select has_function_privilege('service_role', 'public.start_round(uuid,int,text,uuid,jsonb,text)', 'execute'); -- true
select has_function_privilege('anon', 'public.apply_move(uuid,text,text,text,text,text,text,text,uuid)', 'execute'); -- false
select has_function_privilege('authenticated', 'public.recompute_scores(uuid)', 'execute');                    -- false
select has_function_privilege('anon', 'public.join_team_player(uuid,text,text,text[])', 'execute');            -- false
```
- [ ] Alle sjekkene stemmer.

## Gamle halvbygde runder
Turneringer som allerede sitter fast fra før (runden finnes, `current_round` ble aldri flyttet) får nå ærlig `409 round_incomplete` i stedet for stille 200. De repareres ikke automatisk; start en ny turnering, eller be om manuell opprydding.

## Tilbakerulling
Rull tilbake KODEN først. Deretter (valgfritt):
```sql
drop function if exists public.start_round(uuid, int, text, uuid, jsonb, text);
-- Gjenåpner PUBLIC-tilgang til RPC-ene (ikke anbefalt):
grant execute on function public.apply_move(uuid,text,text,text,text,text,text,text,uuid) to public;
grant execute on function public.resolve_game(uuid,text,text,boolean) to public;
grant execute on function public.recompute_scores(uuid) to public;
grant execute on function public.extend_round(uuid) to public;
grant execute on function public.join_team_player(uuid,text,text,text[]) to public;
```
