-- 0017: «Fortsett digitalt» (M5b) – en fysisk turnering fortsetter i spillmotoren.
-- Additiv og idempotent. Rører bare chess-tabellene (players, games).
--
-- 1) games.result_source får verdien 'physical' (resultat ført over brettet).
--    CHECK-en er den fra 0003 pluss 'physical'. Eksisterende rader er urørt.
-- 2) players får fysisk-opprinnelse: rating, klubb/klasse, startnummer, og
--    krav-tilstand (pre_registered + claimed_at). Alle nullable / default false,
--    så vanlige påmeldinger (join) fungerer akkurat som før.
-- 3) Atomisk krav: claim_player() setter claimed_at BARE hvis navnet er ledig.
--    To elever som trykker på samme navn samtidig: nøyaktig én får raden.
--
-- recompute_scores er IKKE endret: frirunder med ½ / 0 poeng lagres som
-- black_player_id = null med status 'draw' / 'aborted' (poeng 0,5 / 0), og full
-- frirunde som 'bye' (1) – alle gir riktig sum i den eksisterende funksjonen.

alter table public.games drop constraint if exists games_result_source_check;
alter table public.games
  add constraint games_result_source_check
  check (
    result_source in (
      'play', 'teacher_override', 'bye', 'timeout_draw', 'walkover', 'opponent_absent', 'physical'
    )
  );

alter table public.players add column if not exists rating int;
alter table public.players add column if not exists club text;
alter table public.players add column if not exists start_no int;
alter table public.players add column if not exists pre_registered boolean not null default false;
alter table public.players add column if not exists claimed_at timestamptz;

-- Ett startnummer per turnering (null = ikke satt, flere tillatt).
create unique index if not exists players_tournament_start_no_idx
  on public.players (tournament_id, start_no) where start_no is not null;

create or replace function public.claim_player(p_tournament_id uuid, p_player_id uuid)
returns setof public.players
language sql
as $$
  update public.players
     set claimed_at = now()
   where id = p_player_id
     and tournament_id = p_tournament_id
     and pre_registered
     and claimed_at is null
     and status = 'active'
  returning *;
$$;

-- Samme lås som øvrige hjelpefunksjoner (0013): ingen anon/authenticated.
revoke all on function public.claim_player(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_player(uuid, uuid) to service_role;
