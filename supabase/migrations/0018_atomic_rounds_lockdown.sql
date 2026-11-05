-- 0018: (1) atomisk runde-oppretting, (2) lås RPC-ene fra 0002/0003/0007/0008.
-- Additiv og idempotent. Rører bare chess-tabellene (tournaments, rounds, games, players).
--
-- 1) start_round(): ÉN transaksjon som (valgfritt) setter forrige runde til
--    'done', oppretter runden, setter inn ALLE partiene (inkl. frirunder) og
--    flytter tournaments.current_round (+ evt. status). Før dette var det fem
--    separate skrivinger fra Worker; døde den midt i, ble det liggende en
--    halvbygd runde, og retry traff unik-indeksen på rounds. Turneringsraden
--    låses (FOR UPDATE), så to samtidige «Neste runde» serialiseres: den andre
--    ser at runden finnes og får conflict='exists' (med complete=true/false).
--    recompute_scores kjøres i samme transaksjon (frirunder gir poeng).
-- 2) M6: apply_move, resolve_game, recompute_scores, extend_round og
--    join_team_player kunne kalles av anon/authenticated via PostgREST
--    (default execute til PUBLIC). Serveren bruker bare service_role.

create or replace function public.start_round(
  p_tournament_id uuid,
  p_number        int,
  p_phase         text,
  p_prev_round_id uuid,
  p_games         jsonb,
  p_set_status    text default null
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  t        public.tournaments%rowtype;
  v_round  uuid;
  v_games  int;
begin
  select * into t from public.tournaments where id = p_tournament_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'conflict', 'no_tournament');
  end if;

  select id into v_round from public.rounds
   where tournament_id = p_tournament_id and phase = p_phase and number = p_number;
  if found then
    select count(*) into v_games from public.games where round_id = v_round;
    return jsonb_build_object(
      'ok', false, 'conflict', 'exists', 'round_id', v_round,
      'complete', v_games > 0 and (
        case when p_phase = 'league' then t.current_round >= p_number
             else t.status in ('playoff', 'finished') and t.current_round >= p_number end
      )
    );
  end if;

  if p_games is null or jsonb_typeof(p_games) <> 'array' or jsonb_array_length(p_games) = 0 then
    return jsonb_build_object('ok', false, 'conflict', 'no_games');
  end if;

  if p_prev_round_id is not null then
    update public.rounds set status = 'done'
     where id = p_prev_round_id and tournament_id = p_tournament_id;
  end if;

  insert into public.rounds (tournament_id, number, phase, status, started_at)
    values (p_tournament_id, p_number, p_phase, 'live', now())
    returning id into v_round;

  insert into public.games (
    tournament_id, round_id, white_player_id, black_player_id,
    fen, pgn, status, result_source, turn, slot
  )
  select p_tournament_id, v_round,
         (e->>'white')::uuid,
         (e->>'black')::uuid,
         e->>'fen', '',
         coalesce(e->>'status', case when e->>'black' is null then 'bye' else 'live' end),
         coalesce(e->>'result_source', case when e->>'black' is null then 'bye' end),
         'w',
         coalesce((e->>'slot')::int, 0)
    from jsonb_array_elements(p_games) as e;

  update public.tournaments
     set current_round = p_number,
         status = coalesce(p_set_status, status)
   where id = p_tournament_id;

  perform public.recompute_scores(p_tournament_id);

  return jsonb_build_object('ok', true, 'round_id', v_round);
end;
$$;

-- M6: kun service_role. (Signaturene er de ferdig-omdefinerte: resolve_game har
-- 4 argumenter siden 0003; 3-arg-versjonen ble droppet der.)
revoke all on function public.start_round(uuid, int, text, uuid, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.start_round(uuid, int, text, uuid, jsonb, text) to service_role;

revoke all on function public.apply_move(uuid, text, text, text, text, text, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.resolve_game(uuid, text, text, boolean)
  from public, anon, authenticated;
revoke all on function public.recompute_scores(uuid)
  from public, anon, authenticated;
revoke all on function public.extend_round(uuid)
  from public, anon, authenticated;
revoke all on function public.join_team_player(uuid, text, text, text[])
  from public, anon, authenticated;

grant execute on function public.apply_move(uuid, text, text, text, text, text, text, text, uuid) to service_role;
grant execute on function public.resolve_game(uuid, text, text, boolean) to service_role;
grant execute on function public.recompute_scores(uuid) to service_role;
grant execute on function public.extend_round(uuid) to service_role;
grant execute on function public.join_team_player(uuid, text, text, text[]) to service_role;

notify pgrst, 'reload schema';
