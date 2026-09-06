-- 0013: close two security-audit findings, SQL-only, idempotent/re-runnable
-- (create-or-replace + revoke; no destructive DDL). Owner runs this by hand in
-- the Supabase SQL editor after 0012. Safe to run any number of times.
--
--   1. `public.cleanup_old_tournaments()` (0010) and `public.cleanup_client_events()`
--      (0012) are `security definer` functions living in `public`, the schema
--      PostgREST exposes over the REST API. Postgres grants EXECUTE to PUBLIC on
--      every new function by default, and no earlier migration revoked it — so
--      `POST /rest/v1/rpc/cleanup_old_tournaments` with the public anon key runs
--      a definer-rights DELETE/UPDATE across every tournament in the shared
--      project. Neither function is ever called by the app — only pg_cron, as
--      the migration-owning role — so revoking EXECUTE from
--      public/anon/authenticated removes the anon RPC surface with zero effect
--      on the app. `service_role` is untouched: it never held (and doesn't need)
--      EXECUTE on these two — the RPCs the app actually calls (`apply_move`,
--      `resolve_game`, `extend_round`, `recompute_scores`, `join_team_player`)
--      are separate functions, unaffected here. (Scope kept deliberately
--      narrow — no schema-wide `alter default privileges` change.)
--
--   2. Casual (1v1) sessions are created with `status: "league"`
--      (`lib/server/casual.ts`), so they ride 0010's league/playoff auto-finish
--      (12h) and are eligible for the casual delete branch (1 day) even while a
--      game is still `live` — a student mid-lesson can have their session
--      deleted out from under them, surfacing as a `404 not_found` on resume.
--      Re-defines `cleanup_old_tournaments()` (create-or-replace, identical
--      otherwise) so the casual delete clause never fires while a live game
--      exists for that tournament, and raises the casual retention window from
--      1 day to 7 days (owner-approved). Cron job name/schedule unchanged from
--      0010 — a body-only change via create-or-replace needs no
--      unschedule/reschedule.

create or replace function public.cleanup_old_tournaments()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  -- (a) Auto-finish stale ACTIVE tournaments (keep the row + standings).
  update public.tournaments t
     set status = 'finished'
   where t.status in ('league', 'playoff')
     and greatest(
           t.created_at,
           coalesce(
             (select max(g.updated_at) from public.games g where g.tournament_id = t.id),
             t.created_at
           )
         ) < now() - interval '12 hours';

  -- (b) Delete abandoned / expired tournaments.
  with doomed as (
    delete from public.tournaments t
    where
      -- empty abandoned lobby: nobody joined, never started, > 2 days old
      (
        t.status = 'lobby'
        and t.created_at < now() - interval '2 days'
        and not exists (select 1 from public.players p where p.tournament_id = t.id)
      )
      -- casual 1v1: throwaway — drop after 7 days of inactivity, but never while
      -- a game in it is still live (a student may be mid-session).
      or (
        coalesce((t.config->>'casual')::boolean, false) = true
        and greatest(
              t.created_at,
              coalesce(
                (select max(g.updated_at) from public.games g where g.tournament_id = t.id),
                t.created_at
              )
            ) < now() - interval '7 days'
        and not exists (
          select 1 from public.games g
           where g.tournament_id = t.id and g.status = 'live'
        )
      )
      -- everything else: no activity (created / joined / played) for 30 days
      or greatest(
           t.created_at,
           coalesce(
             (select max(g.updated_at) from public.games g where g.tournament_id = t.id),
             t.created_at
           ),
           coalesce(
             (select max(p.joined_at) from public.players p where p.tournament_id = t.id),
             t.created_at
           )
         ) < now() - interval '30 days'
    returning 1
  )
  select count(*) into removed from doomed;
  return removed;
end;
$$;

-- Anon/authenticated must never be able to invoke either cleanup function
-- directly over PostgREST. `revoke ... from public` also covers any role that
-- only ever held the implicit PUBLIC grant; listing anon/authenticated
-- explicitly too so this is a no-op-safe re-run even if a future migration
-- ever grants to them directly.
revoke execute on function public.cleanup_old_tournaments() from public, anon, authenticated;
revoke execute on function public.cleanup_client_events() from public, anon, authenticated;
