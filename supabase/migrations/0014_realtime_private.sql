-- 0014: Realtime Authorization for SundayChess' channels (private channels).
-- Additive and idempotent (create or replace / drop policy if exists). No triggers.
--
-- Today every chess topic is a PUBLIC broadcast topic: anyone holding the anon
-- key (it ships in the client bundle) and a tournament / game id (both appear
-- in URLs) can .send() forged `roster` / `tournament` / `position` / `result`
-- hints. No data is corrupted — hints only trigger a refetch of authoritative
-- state — but a forged hint makes a whole classroom refetch at once.
--
-- Fix: clients subscribe with `private: true`, which makes Realtime authorize
-- every join against RLS on realtime.messages. Topics (lib/realtime.ts):
--   chess:lobby:<tournament>     server hints   — anon may RECEIVE only
--   chess:spectate:<tournament>  server hints   — anon may RECEIVE only
--   chess:game:<game>            server hints   — anon may RECEIVE; may also
--                                SEND broadcast (emoji reactions, ephemeral)
--   chess:presence:<tournament>  presence       — anon may RECEIVE and TRACK
-- Server publishes use the service_role REST endpoint and bypass RLS. Every
-- policy also requires the tournament / game to EXIST (chess_rt_topic_ok), so
-- nobody can squat arbitrary chess:* topics: an id is only knowable by someone
-- who was handed it (join link / board URL).
--
-- ⚠️ This project is SHARED with other Sunday apps. Policies on
-- realtime.messages are OR'ed across apps per command, so every policy here is
-- scoped to `chess:` topics and touches nothing else. Do NOT disable public
-- channels project-wide until every app in the project subscribes privately.
--
-- Realtime runs probe SELECT/INSERTs on realtime.messages AS the subscriber's
-- role, so anon/authenticated need plain grants as well as the policies — a
-- policy alone yields "Unauthorized" at subscribe.
--
-- realtime.messages is Supabase-managed and absent from a vanilla postgres
-- harness, so the grants + policies are guarded on its presence (clean no-op
-- there). Safe to apply BEFORE the client switches to private channels: public
-- channels are not affected by these policies.

-- 1. chess_rt_topic_ok ---------------------------------------------------------
-- True iff `p_topic` is one of this app's topic shapes for an EXISTING
-- tournament (lobby/spectate/presence) or game (game). security definer so the
-- policies can check existence without anon having any table access. The regex
-- is checked before the cast (case), so a junk topic is false, not an error.
create or replace function public.chess_rt_topic_ok(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_topic ~* '^chess:(lobby|spectate|presence):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then exists (
        select 1 from public.tournaments
        where id = substring(p_topic from '[0-9a-fA-F-]{36}$')::uuid
      )
    when p_topic ~* '^chess:game:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then exists (
        select 1 from public.games
        where id = substring(p_topic from '[0-9a-fA-F-]{36}$')::uuid
      )
    else false
  end
$$;

revoke all on function public.chess_rt_topic_ok(text) from public;
grant execute on function public.chess_rt_topic_ok(text) to anon, authenticated, service_role;

-- 2. grants + policies on realtime.messages ------------------------------------
do $$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'realtime.messages absent (test harness) — skipping Realtime grants/policies';
    return;
  end if;

  execute 'grant usage on schema realtime to anon, authenticated';
  execute 'grant select, insert on realtime.messages to anon, authenticated';

  -- RECEIVE (broadcast + presence) on all four topic shapes.
  execute 'drop policy if exists "chess_rt_receive" on realtime.messages';
  execute $p$
    create policy "chess_rt_receive"
      on realtime.messages
      for select
      to anon, authenticated
      using (
        realtime.topic() like 'chess:%'
        and public.chess_rt_topic_ok(realtime.topic())
      )
  $p$;

  -- SEND reactions: broadcast on chess:game:<id> only.
  execute 'drop policy if exists "chess_rt_game_send" on realtime.messages';
  execute $p$
    create policy "chess_rt_game_send"
      on realtime.messages
      for insert
      to anon, authenticated
      with check (
        realtime.topic() like 'chess:game:%'
        and realtime.messages.extension = 'broadcast'
        and public.chess_rt_topic_ok(realtime.topic())
      )
  $p$;

  -- TRACK presence: presence on chess:presence:<id> only.
  execute 'drop policy if exists "chess_rt_presence_send" on realtime.messages';
  execute $p$
    create policy "chess_rt_presence_send"
      on realtime.messages
      for insert
      to anon, authenticated
      with check (
        realtime.topic() like 'chess:presence:%'
        and realtime.messages.extension = 'presence'
        and public.chess_rt_topic_ok(realtime.topic())
      )
  $p$;

  -- NO insert policy for chess:lobby / chess:spectate → forged client hints are
  -- denied by default-deny RLS.
end $$;
