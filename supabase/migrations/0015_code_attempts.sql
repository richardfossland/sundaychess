-- 0015: DB-backed wrong-code counter (replaces the per-isolate in-memory
-- hostRateLimit). Additive and idempotent.
--
-- A school hall puts 30 phones behind ONE public IP, and Cloudflare runs many
-- isolates, so a per-isolate request counter both lets a determined guesser
-- through (fresh bucket per isolate) and locks the teacher out (one shared IP).
-- This counts ONLY wrong codes, in the database, per (scope, ip). `scope` is the
-- tournament id for host-code routes and 'open' for the host-code lookup.
-- IPv6 clients arrive already bucketed by /64 (lib/server/http.ts ipKeyOf).
-- The teacher's paired device bypasses the block via a stateless HMAC token
-- (lib/server/pair.ts), so a pupil's wrong guesses can't lock the teacher out.

create table if not exists public.code_attempts (
  scope        text        not null,
  ip           text        not null,
  window_start timestamptz not null default now(),
  failures     int         not null default 0,
  primary key (scope, ip)
);
create index if not exists code_attempts_window_idx
  on public.code_attempts (window_start);
alter table public.code_attempts enable row level security;
-- No policies on purpose: service role only (same as every other table).
revoke all on public.code_attempts from anon, authenticated;
grant select, insert, update, delete on public.code_attempts to service_role;

-- Records one wrong guess. Starts a fresh window when the old one expired.
-- Returns true when this IP is now blocked for the scope.
create or replace function public.register_code_failure(
  p_scope    text,
  p_ip       text,
  p_window_s int,
  p_max      int
) returns boolean
language plpgsql
set search_path = ''
as $$
declare
  f int;
begin
  -- Keep the table small: forget anything long past any window.
  delete from public.code_attempts where window_start < now() - interval '1 day';

  insert into public.code_attempts as a (scope, ip, window_start, failures)
    values (p_scope, p_ip, now(), 1)
  on conflict (scope, ip) do update
    set failures     = case when a.window_start < now() - make_interval(secs => p_window_s)
                            then 1 else a.failures + 1 end,
        window_start = case when a.window_start < now() - make_interval(secs => p_window_s)
                            then now() else a.window_start end
  returning a.failures into f;

  return f >= p_max;
end;
$$;

create or replace function public.code_blocked(
  p_scope    text,
  p_ip       text,
  p_window_s int,
  p_max      int
) returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select failures >= p_max
           and window_start >= now() - make_interval(secs => p_window_s)
      from public.code_attempts
     where scope = p_scope and ip = p_ip
  ), false);
$$;

revoke execute on function public.register_code_failure(text, text, int, int)
  from public, anon, authenticated;
revoke execute on function public.code_blocked(text, text, int, int)
  from public, anon, authenticated;
grant execute on function public.register_code_failure(text, text, int, int) to service_role;
grant execute on function public.code_blocked(text, text, int, int) to service_role;
